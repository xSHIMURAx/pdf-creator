const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const { PDFDocument } = require('pdf-lib');

// Fuerza el nombre visible de la app (y con esto la carpeta de datos en
// %AppData%\Roaming) a "PDF Creator" en vez de tomar el "name" de
// package.json (convertidor-pdf, el nombre viejo del proyecto). Debe
// llamarse antes de que la app este "ready" para que afecte a userData.
app.setName('PDF Creator');

const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.bmp'];
// .rar/.cbr se soportan si hay 7-Zip o WinRAR instalados (ver buscarExtractorRar)
const EXTENSIONES_COMPRIMIDO = ['.zip', '.cbz', '.rar', '.cbr'];

let mainWindow = null;
const carpetasTemporales = []; // se limpian al cerrar la app
let cancelarConversionSolicitado = false;

// backgroundMaterial:'acrylic' solo existe desde Windows 11 22H2 (build 22621).
// 'mica' existe desde la primera version de Windows 11 (build 22000).
// En versiones anteriores (Windows 10 incluido) Electron simplemente lo
// ignora, pero lo detectamos igual para no arrastrar codigo muerto y para
// poder loguear/depurar si hace falta.
function numeroDeBuildWindows() {
  if (process.platform !== 'win32') return null;
  const build = parseInt(os.release().split('.')[2], 10);
  return Number.isFinite(build) ? build : null;
}
function esWindows11Mica() {
  const build = numeroDeBuildWindows();
  return build !== null && build >= 22000;
}
function esWindows11Acrylic() {
  const build = numeroDeBuildWindows();
  return build !== null && build >= 22621;
}

// backdrop-filter (CSS) NUNCA puede desenfocar lo que hay realmente detras
// de una ventana transparente (el escritorio, otras ventanas): Chromium solo
// puede desenfocar contenido pintado dentro de la propia pagina. Como
// .ventana es transparente y no tiene nada del DOM detras, el backdrop-filter
// ahi no hace nada de verdad (ver charla en el historial del proyecto).
// La unica forma de desenfocar el escritorio real detras de la ventana es el
// material nativo de Windows (backgroundMaterial: 'mica' / 'acrylic'), pero
// su intensidad la controla Windows, no se puede parametrizar con un numero
// de px. Por eso el panel de opciones ya no ofrece una barra continua de
// "px de blur": ofrece 2 niveles fijos en la UI que van directo al material
// nativo (el nivel intermedio 'mica' sigue existiendo internamente solo como
// fallback automatico de 'acrilico' en builds de Windows que no soportan
// acrylic, ver materialSoportadoParaNivel):
//   'ninguno'  -> backgroundMaterial 'none' (sin blur, solo tinte via CSS)
//   'acrilico' -> backgroundMaterial 'acrylic' (blur fuerte, Windows 11 22H2+;
//                 si el build no lo soporta, cae a 'mica' y si tampoco a 'none')
// Si el build de Windows no soporta el nivel pedido, se hace fallback al
// nivel mas fuerte que si soporte (ver aplicarNivelDesenfoque).
const NIVEL_DESENFOQUE_POR_DEFECTO = 'acrilico';

// ================= Configuracion persistente (transparencia/desenfoque) =================
// Se guarda en un config.json dentro de la carpeta de datos de la app
// (userData), asi que sobrevive entre sesiones/aperturas de la app, no solo
// mientras la ventana esta abierta.
let script_rutaConfig; // cache de la ruta, se resuelve recien cuando app.getPath ya esta disponible
function rutaConfig() {
  if (!script_rutaConfig) script_rutaConfig = path.join(app.getPath('userData'), 'config.json');
  return script_rutaConfig;
}
const CONFIG_POR_DEFECTO = { transparencia: 50, nivelDesenfoque: NIVEL_DESENFOQUE_POR_DEFECTO };

function cargarConfiguracion() {
  try {
    const contenido = fs.readFileSync(rutaConfig(), 'utf8');
    return { ...CONFIG_POR_DEFECTO, ...JSON.parse(contenido) };
  } catch {
    return { ...CONFIG_POR_DEFECTO };
  }
}

function guardarConfiguracion(parcial) {
  const actual = cargarConfiguracion();
  const nueva = { ...actual, ...parcial };
  try {
    fs.writeFileSync(rutaConfig(), JSON.stringify(nueva, null, 2));
  } catch { /* si falla el guardado no interrumpe el uso de la app */ }
  return nueva;
}

function materialSoportadoParaNivel(nivel) {
  if (nivel === 'acrilico') {
    if (esWindows11Acrylic()) return 'acrylic';
    if (esWindows11Mica()) return 'mica';
    return 'none';
  }
  if (nivel === 'mica') {
    return esWindows11Mica() ? 'mica' : 'none';
  }
  return 'none'; // 'ninguno', o plataforma sin soporte
}

// Aplica el nivel a la ventana actual (solo tiene efecto real en Windows) y
// devuelve el nivel efectivamente aplicado (por si hubo fallback), para que
// el renderer pueda reflejar el estado real en los botones.
function aplicarNivelDesenfoque(nivel) {
  const nivelValido = ['ninguno', 'mica', 'acrilico'].includes(nivel) ? nivel : 'ninguno';
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    const material = materialSoportadoParaNivel(nivelValido);
    mainWindow.setBackgroundMaterial(material);
    if (material === 'none') return 'ninguno';
    if (material === 'mica') return 'mica';
    return 'acrilico';
  }
  return 'ninguno'; // sin Windows no hay material nativo que aplicar
}

function crearVentana() {
  const configGuardada = cargarConfiguracion();
  mainWindow = new BrowserWindow({
    width: 650,
    height: 933,
    resizable: false,
    maximizable: false,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Nivel de desenfoque nativo inicial (ver NIVEL_DESENFOQUE_POR_DEFECTO
    // y aplicarNivelDesenfoque arriba). Se pasa aqui mismo en la creacion
    // para que la ventana ya nazca con el material correcto en Windows;
    // ademas aplicarNivelDesenfoque() se vuelve a llamar despues por si el
    // build de Windows no soporta el nivel pedido (fallback).
    ...(process.platform === 'win32'
      ? { backgroundMaterial: materialSoportadoParaNivel(configGuardada.nivelDesenfoque) }
      : {}),
    roundedCorners: false,
    thickFrame: false,
    hasShadow: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const rutasIniciales = obtenerRutasDesdeArgv(process.argv);
    if (rutasIniciales.length > 0) {
      mainWindow.webContents.send('app:rutas-iniciales', rutasIniciales);
    }
    // Se re-aplica (no solo se confia en backgroundMaterial de las opciones
    // de creacion) para obtener el nivel real ya resuelto con fallback, y
    // se lo mandamos al renderer junto con la transparencia guardada para
    // que la ventana arranque exactamente como quedo la ultima vez.
    const nivelReal = aplicarNivelDesenfoque(configGuardada.nivelDesenfoque);
    if (nivelReal !== configGuardada.nivelDesenfoque) guardarConfiguracion({ nivelDesenfoque: nivelReal });
    mainWindow.webContents.send('app:configuracion-inicial', {
      transparencia: configGuardada.transparencia,
      nivelDesenfoque: nivelReal,
    });
    forzarRepintadoDesenfoqueInicial();
  });
}

// Bug conocido de Electron (frame:false + backgroundMaterial): el material
// nativo (mica/acrylic) no se pinta al crear la ventana la primera vez, hace
// falta un repintado real (resize u otra accion similar) para que Windows lo
// aplique visualmente, aunque la API ya lo haya "aceptado" sin error. Recien
// se corrigio en Electron 35/36 (ver electron/electron#46657 y #39708); esta
// app usa Electron 31, asi que se fuerza el repintado a mano: se agranda la
// ventana 1px y se vuelve a su tamaño original en el siguiente tick. Antes
// esto obligaba al usuario a tocar manualmente "Ninguno" y luego "Acrilico"
// para que el efecto apareciera.
function forzarRepintadoDesenfoqueInicial() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const [ancho, alto] = mainWindow.getSize();
  mainWindow.setSize(ancho + 1, alto);
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(ancho, alto);
    }
  });
}

// ================= IPC: nivel de desenfoque (material nativo) =================
ipcMain.handle('window:establecerNivelDesenfoque', (_e, nivel) => {
  const nivelReal = aplicarNivelDesenfoque(nivel);
  guardarConfiguracion({ nivelDesenfoque: nivelReal });
  return nivelReal;
});

// ================= IPC: transparencia =================
// El renderer manda el valor (20-100) cada vez que el usuario suelta el
// slider, para no escribir a disco en cada pixel de movimiento.
ipcMain.on('config:guardarTransparencia', (_e, valor) => {
  const numero = Number(valor);
  if (Number.isFinite(numero)) guardarConfiguracion({ transparencia: numero });
});

// ================= IPC: controles de la barra de titulo custom =================
// Con frame:false ya no hay minimizar/cerrar nativos, asi que los botones
// dibujados en index.html (igual que btnMin/btnClose de la version PowerShell)
// llaman a esto.
ipcMain.on('window:minimizar', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window:cerrar', () => { if (mainWindow) mainWindow.close(); });

// Abre un enlace en el navegador del sistema (nunca dentro de la app).
// Se valida que sea http/https para no poder usarse para abrir rutas locales.
ipcMain.on('shell:abrirExterno', (_e, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch {}
});

// Cuando se abre el .exe con archivos/carpetas arrastrados o "Abrir con"
// (electron-builder registra esto como argumentos extra al final de argv).
function obtenerRutasDesdeArgv(argv) {
  const esEmpaquetado = app.isPackaged;
  const desde = esEmpaquetado ? 1 : 2; // sin empaquetar: electron.exe . <rutas...>
  return argv.slice(desde).filter((a) => {
    try { return fs.existsSync(a); } catch { return false; }
  });
}

app.whenReady().then(crearVentana);

app.on('window-all-closed', () => {
  for (const carpeta of carpetasTemporales) {
    try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

// ================= Utilidades de listado =================

// Orden natural (Imagen2 antes que Imagen10), igual que la version PowerShell.
function compararNatural(a, b) {
  const partirEnTrozos = (s) =>
    s.match(/(\d+|\D+)/g).map((t) => (/^\d+$/.test(t) ? parseInt(t, 10) : t));
  const ta = partirEnTrozos(path.basename(a).toLowerCase());
  const tb = partirEnTrozos(path.basename(b).toLowerCase());
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const xa = ta[i];
    const xb = tb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    if (typeof xa === 'number' && typeof xb === 'number') {
      if (xa !== xb) return xa - xb;
    } else {
      const cmp = String(xa).localeCompare(String(xb));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

function listarImagenesDeCarpeta(carpeta, recursivo) {
  const resultado = [];
  const pila = [carpeta];
  while (pila.length > 0) {
    const actual = pila.pop();
    let entradas;
    try {
      entradas = fs.readdirSync(actual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const rutaCompleta = path.join(actual, entrada.name);
      if (entrada.isDirectory()) {
        if (recursivo) pila.push(rutaCompleta);
      } else if (EXTENSIONES_IMAGEN.includes(path.extname(entrada.name).toLowerCase())) {
        resultado.push(rutaCompleta);
      }
    }
  }
  return resultado.sort(compararNatural);
}

// Busca 7-Zip o WinRAR instalados en el sistema para poder extraer .rar/.cbr
// (igual estrategia que la version PowerShell: no se distribuye ningun
// binario de RAR con la app, solo se usa uno que el usuario ya tenga).
let script_rutaExtractorRar; // cache: string con la ruta, o null si ya se busco y no hay
function buscarExtractorRar() {
  if (script_rutaExtractorRar !== undefined) return script_rutaExtractorRar;
  const candidatos = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WinRAR', 'UnRAR.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WinRAR', 'UnRAR.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WinRAR', 'Rar.exe'),
  ];
  script_rutaExtractorRar = candidatos.find((ruta) => { try { return fs.existsSync(ruta); } catch { return false; } }) || null;
  return script_rutaExtractorRar;
}

// Extrae un .zip/.cbz/.rar/.cbr a una carpeta temporal y devuelve esa carpeta.
function extraerComprimido(rutaArchivo) {
  const carpetaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'convertidorpdf-'));
  carpetasTemporales.push(carpetaTemp);
  const ext = path.extname(rutaArchivo).toLowerCase();

  if (ext === '.zip' || ext === '.cbz') {
    const zip = new AdmZip(rutaArchivo);
    zip.extractAllTo(carpetaTemp, true);
    return Promise.resolve(carpetaTemp);
  }

  // .rar / .cbr: requiere 7-Zip o WinRAR instalados
  const herramienta = buscarExtractorRar();
  if (!herramienta) {
    return Promise.reject(new Error(
      `Para agregar archivos .rar/.cbr hace falta tener instalado 7-Zip o WinRAR.\nNo se pudo abrir "${path.basename(rutaArchivo)}".`
    ));
  }
  const esSieteZip = path.basename(herramienta).toLowerCase().startsWith('7z');
  const args = esSieteZip
    ? ['x', rutaArchivo, `-o${carpetaTemp}`, '-y']
    : ['x', '-y', rutaArchivo, carpetaTemp + path.sep];
  return new Promise((resolve, reject) => {
    execFile(herramienta, args, (error) => {
      if (error) reject(new Error(`No se pudo extraer "${path.basename(rutaArchivo)}": ${error.message}`));
      else resolve(carpetaTemp);
    });
  });
}

// ================= IPC: dialogos =================

ipcMain.handle('dialog:elegirCarpeta', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:elegirImagenesOCarpetas', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Imagenes y comprimidos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'zip', 'cbz', 'rar', 'cbr'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:elegirCarpetaSalida', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('shell:abrirCarpeta', (_e, ruta) => {
  shell.showItemInFolder(ruta);
});

ipcMain.handle('shell:abrirArchivo', (_e, ruta) => {
  shell.openPath(ruta);
});

// ================= IPC: resolver rutas (carpetas, archivos sueltos, comprimidos) =================

// Recibe una lista de rutas (lo que el usuario eligio, o lo que llego por
// "Abrir con"/drag&drop) y devuelve { imagenes: [...], carpetaBase, nombreSugerido }
ipcMain.handle('imagenes:resolverRutas', async (_e, rutas, recursivo) => {
  const imagenes = [];
  let carpetaBase = null;
  let nombreSugerido = null;

  for (const ruta of rutas) {
    let stat;
    try { stat = fs.statSync(ruta); } catch { continue; }

    if (stat.isDirectory()) {
      const encontradas = listarImagenesDeCarpeta(ruta, recursivo);
      imagenes.push(...encontradas);
      if (!carpetaBase) { carpetaBase = ruta; nombreSugerido = path.basename(ruta); }
    } else if (EXTENSIONES_COMPRIMIDO.includes(path.extname(ruta).toLowerCase())) {
      const carpetaExtraida = await extraerComprimido(ruta);
      const encontradas = listarImagenesDeCarpeta(carpetaExtraida, true);
      imagenes.push(...encontradas);
      // El PDF debe quedar junto al comprimido, no en la carpeta temporal
      // donde se extrajeron las imagenes.
      if (!carpetaBase) { carpetaBase = path.dirname(ruta); nombreSugerido = path.basename(ruta, path.extname(ruta)); }
    } else if (EXTENSIONES_IMAGEN.includes(path.extname(ruta).toLowerCase())) {
      imagenes.push(ruta);
      if (!carpetaBase) { carpetaBase = path.dirname(ruta); nombreSugerido = path.basename(carpetaBase); }
    }
  }

  return { imagenes: imagenes.sort(compararNatural), carpetaBase, nombreSugerido };
});

// ================= IPC: miniaturas =================

const cacheMiniaturas = new Map(); // ruta -> dataURL

ipcMain.handle('imagenes:miniatura', async (_e, rutaImagen) => {
  if (cacheMiniaturas.has(rutaImagen)) return cacheMiniaturas.get(rutaImagen);
  try {
    const buffer = await sharp(rutaImagen)
      .resize(160, 160, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    cacheMiniaturas.set(rutaImagen, dataUrl);
    return dataUrl;
  } catch (err) {
    return null;
  }
});

// ================= IPC: conversion a PDF =================

ipcMain.handle('pdf:convertir', async (event, { imagenes, calidad, nombrePDF, carpetaSalida, carpetaBase }) => {
  if (!imagenes || imagenes.length === 0) throw new Error('No hay imagenes para convertir.');

  cancelarConversionSolicitado = false;

  const enviarProgreso = (actual, total, texto) => {
    event.sender.send('pdf:progreso', { actual, total, texto });
  };

  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < imagenes.length; i++) {
    if (cancelarConversionSolicitado) {
      throw new Error('CANCELADO_POR_USUARIO');
    }

    const rutaImagen = imagenes[i];
    enviarProgreso(i + 1, imagenes.length, `Procesando ${path.basename(rutaImagen)} (${i + 1}/${imagenes.length})...`);

    // Todas las imagenes se normalizan a JPEG con la calidad elegida (igual
    // logica que la version PowerShell con magick.exe, pero via sharp/libvips,
    // que ya sabe leer JPG/PNG/WEBP/AVIF/BMP sin depender de un binario externo).
    const imagenSharp = sharp(rutaImagen).rotate(); // .rotate() sin args = respeta EXIF
    const metadata = await imagenSharp.metadata();
    const bufferJpeg = await imagenSharp.jpeg({ quality: Math.max(1, Math.min(100, calidad)) }).toBuffer();

    const imagenEmbebida = await pdfDoc.embedJpg(bufferJpeg);
    const ancho = metadata.width || imagenEmbebida.width;
    const alto = metadata.height || imagenEmbebida.height;

    const pagina = pdfDoc.addPage([ancho, alto]);
    pagina.drawImage(imagenEmbebida, { x: 0, y: 0, width: ancho, height: alto });
  }

  enviarProgreso(imagenes.length, imagenes.length, 'Guardando PDF...');

  const nombreBase = (nombrePDF && nombrePDF.trim()) || path.basename(carpetaBase || 'Documento');
  const nombreArchivo = nombreBase.replace(/\.pdf$/i, '') + '.pdf';
  const carpetaDestino = carpetaSalida && carpetaSalida.trim() ? carpetaSalida : (carpetaBase || app.getPath('documents'));
  const rutaFinal = path.join(carpetaDestino, nombreArchivo);

  const bytesPdf = await pdfDoc.save();
  fs.writeFileSync(rutaFinal, bytesPdf);

  return rutaFinal;
});

ipcMain.on('pdf:cancelar', () => {
  cancelarConversionSolicitado = true;
});
