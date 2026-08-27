// Estado en memoria (equivalente al $lstImagenes.Items de la version PowerShell)
let imagenes = [];
let seleccionIndice = -1;
let carpetaBase = null;
let modoMiniaturas = true;
// Rutas de origen (carpetas o comprimidos) ya procesadas, para no volver a
// extraer/agregar el mismo .zip/.rar (o carpeta) dos veces: como cada
// comprimido se extrae a una carpeta temporal distinta cada vez, el filtro
// por ruta de imagen no alcanza a detectar ese duplicado.
const fuentesAgregadas = new Set();
// Copia (con mayusculas/minusculas originales, en orden) de las mismas rutas
// de origen de arriba, para poder volver a resolverlas todas si el usuario
// tilda/destilda "Incluir subcarpetas" despues de haberlas agregado (ver
// listener de chkSubcarpetas mas abajo).
let fuentesOriginales = [];

const $ = (id) => document.getElementById(id);
const txtCarpeta = $('txtCarpeta');
const chkSubcarpetas = $('chkSubcarpetas');
const lblContador = $('lblContador');
const listaImagenes = $('listaImagenes');
const gridMiniaturas = $('gridMiniaturas');
const rangoCalidad = $('rangoCalidad');
const valorCalidad = $('valorCalidad');
const txtNombrePDF = $('txtNombrePDF');
const txtRutaSalida = $('txtRutaSalida');
const lblEstado = $('lblEstado');
const barraProgreso = $('barraProgreso');
const barraProgresoRelleno = $('barraProgresoRelleno');

function setEstado(texto, tipo) {
  lblEstado.textContent = texto;
  lblEstado.classList.remove('estado-exito', 'estado-error');
  if (tipo === 'exito') lblEstado.classList.add('estado-exito');
  else if (tipo === 'error') lblEstado.classList.add('estado-error');
}

// Sonido de exito al terminar la conversion, generado con Web Audio API
// (sin archivos externos, dos notas ascendentes tipo "campanita").
let contextoAudio = null;
function reproducirSonidoExito() {
  try {
    if (!contextoAudio) contextoAudio = new (window.AudioContext || window.webkitAudioContext)();
    const ahora = contextoAudio.currentTime;
    const notas = [{ freq: 880, inicio: 0 }, { freq: 1318.51, inicio: 0.1 }];
    notas.forEach(({ freq, inicio }) => {
      const oscilador = contextoAudio.createOscillator();
      const ganancia = contextoAudio.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.value = freq;
      ganancia.gain.setValueAtTime(0, ahora + inicio);
      ganancia.gain.linearRampToValueAtTime(0.22, ahora + inicio + 0.02);
      ganancia.gain.exponentialRampToValueAtTime(0.001, ahora + inicio + 0.35);
      oscilador.connect(ganancia);
      ganancia.connect(contextoAudio.destination);
      oscilador.start(ahora + inicio);
      oscilador.stop(ahora + inicio + 0.35);
    });
  } catch { /* si el audio falla, no interrumpe el flujo de la app */ }
}

function actualizarContador() {
  lblContador.textContent = `Imagenes agregadas: ${imagenes.length} imagen${imagenes.length === 1 ? '' : 'es'}`;
}

function nombreCorto(ruta) {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1];
}

// Reordenar arrastrando con el mouse (equivalente a lo que en la version
// PowerShell se hacia con los botones Subir/Bajar, mas comodo con drag&drop
// nativo del navegador -- no hace falta una libreria como SortableJS).
let indiceArrastrado = -1;

async function renderizarLista() {
  if (!modoMiniaturas) {
    listaImagenes.innerHTML = '';
    imagenes.forEach((ruta, i) => {
      const div = document.createElement('div');
      div.className = 'item-lista' + (i === seleccionIndice ? ' seleccionado' : '');
      div.textContent = ruta;
      div.title = ruta;
      div.draggable = true;
      div.addEventListener('click', () => { seleccionIndice = i; renderizarLista(); });
      div.addEventListener('dragstart', (e) => {
        indiceArrastrado = i;
        div.classList.add('arrastrando');
        e.dataTransfer.effectAllowed = 'move';
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('arrastrando');
        listaImagenes.querySelectorAll('.dropzone').forEach((el) => el.classList.remove('dropzone'));
      });
      div.addEventListener('dragover', (e) => {
        if (indiceArrastrado === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listaImagenes.querySelectorAll('.dropzone').forEach((el) => el.classList.remove('dropzone'));
        if (i !== indiceArrastrado) div.classList.add('dropzone');
      });
      div.addEventListener('drop', (e) => {
        // Si el arrastre no vino de dentro de esta misma lista (por ej. una
        // carpeta soltada desde el Explorador de Windows), no lo bloqueamos:
        // dejamos que el evento suba hasta el listener de "window" que
        // agrega esos archivos externos. Antes se cortaba aca con
        // stopPropagation() y la carpeta soltada nunca se agregaba.
        if (indiceArrastrado === -1 || indiceArrastrado === i) return;
        e.preventDefault();
        e.stopPropagation();
        const [movida] = imagenes.splice(indiceArrastrado, 1);
        const destino = i > indiceArrastrado ? i - 1 : i;
        imagenes.splice(destino, 0, movida);
        seleccionIndice = destino;
        indiceArrastrado = -1;
        renderizarLista();
      });
      listaImagenes.appendChild(div);
    });
  } else {
    gridMiniaturas.innerHTML = '';
    for (let i = 0; i < imagenes.length; i++) {
      const ruta = imagenes[i];
      const div = document.createElement('div');
      div.className = 'item-grid' + (i === seleccionIndice ? ' seleccionado' : '');
      const img = document.createElement('img');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7'; // placeholder 1x1
      const span = document.createElement('span');
      span.textContent = nombreCorto(ruta);
      div.appendChild(img);
      div.appendChild(span);
      div.draggable = true;
      div.addEventListener('click', () => { seleccionIndice = i; renderizarLista(); });
      div.addEventListener('dblclick', () => { window.api.abrirArchivoConVisorPredeterminado(ruta); });
      div.addEventListener('dragstart', (e) => {
        indiceArrastrado = i;
        div.classList.add('arrastrando');
        e.dataTransfer.effectAllowed = 'move';
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('arrastrando');
        gridMiniaturas.querySelectorAll('.dropzone').forEach((el) => el.classList.remove('dropzone'));
      });
      div.addEventListener('dragover', (e) => {
        if (indiceArrastrado === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        gridMiniaturas.querySelectorAll('.dropzone').forEach((el) => el.classList.remove('dropzone'));
        if (i !== indiceArrastrado) div.classList.add('dropzone');
      });
      div.addEventListener('drop', (e) => {
        // Igual criterio que en la vista de lista: si el arrastre no vino
        // de una miniatura de esta misma grilla (por ej. una carpeta
        // soltada desde el Explorador de Windows), no lo bloqueamos, para
        // que el listener de "window" pueda agregar esos archivos externos.
        if (indiceArrastrado === -1 || indiceArrastrado === i) return;
        e.preventDefault();
        e.stopPropagation();
        const [movida] = imagenes.splice(indiceArrastrado, 1);
        const destino = i > indiceArrastrado ? i - 1 : i;
        imagenes.splice(destino, 0, movida);
        seleccionIndice = destino;
        indiceArrastrado = -1;
        renderizarLista();
      });
      gridMiniaturas.appendChild(div);
      window.api.obtenerMiniatura(ruta).then((dataUrl) => { if (dataUrl) img.src = dataUrl; });
    }
  }
}

async function agregarRutas(rutas, opciones) {
  if (!rutas || rutas.length === 0) return;
  const reemplazarLista = !!(opciones && opciones.reemplazarLista);
  // Filtra rutas de origen (carpetas/comprimidos/imagenes sueltas) que ya
  // fueron agregadas antes, para no reprocesar el mismo comprimido y que
  // termine sumando sus imagenes por duplicado. Al re-resolver por un
  // cambio de "Incluir subcarpetas" esto se salta, porque ahi la intencion
  // es justamente volver a procesar las mismas rutas con el nuevo valor.
  const rutasNuevas = reemplazarLista ? rutas : rutas.filter((r) => !fuentesAgregadas.has(r.toLowerCase()));
  if (rutasNuevas.length === 0) {
    setEstado('No se agrego nada nuevo (ya estaba en la lista).');
    return;
  }
  setEstado('Cargando imagenes...');
  try {
    const resultado = await window.api.resolverRutas(rutasNuevas, chkSubcarpetas.checked);
    const nuevas = reemplazarLista ? resultado.imagenes : resultado.imagenes.filter((r) => !imagenes.includes(r));
    imagenes.push(...nuevas);
    rutasNuevas.forEach((r) => {
      if (!fuentesAgregadas.has(r.toLowerCase())) fuentesOriginales.push(r);
      fuentesAgregadas.add(r.toLowerCase());
    });
    if (!carpetaBase && resultado.carpetaBase) {
      carpetaBase = resultado.carpetaBase;
      txtCarpeta.value = resultado.nombreSugerido || carpetaBase;
      if (!txtNombrePDF.value.trim()) txtNombrePDF.value = resultado.nombreSugerido || '';
    }
    actualizarContador();
    renderizarLista();
    setEstado(nuevas.length > 0 ? `${nuevas.length} imagen(es) agregada(s).` : 'No se agrego nada nuevo (ya estaba en la lista).');
  } catch (err) {
    setEstado('Error al agregar: ' + err.message, 'error');
  }
}

// Si el usuario tilda o destilda "Incluir subcarpetas" DESPUES de haber
// agregado carpetas, hay que volver a resolverlas todas con el nuevo valor:
// antes esto no hacia nada (la casilla solo se leia en la proxima carpeta
// que se agregara), asi que activarla despues de abrir una carpeta sin
// imagenes en su raiz (solo en subcarpetas) dejaba la lista en 0 imagenes
// para siempre.
chkSubcarpetas.addEventListener('change', async () => {
  if (fuentesOriginales.length === 0) return; // nada cargado todavia
  const rutasPrevias = fuentesOriginales;
  imagenes = [];
  seleccionIndice = -1;
  carpetaBase = null;
  fuentesAgregadas.clear();
  fuentesOriginales = [];
  await agregarRutas(rutasPrevias, { reemplazarLista: true });
});

// ---- Barra de titulo custom ----

// ================= Panel de opciones (transparencia) =================
// Popover simple anclado al boton de engranaje: se abre/cierra con el
// propio boton y se cierra al hacer click afuera. El slider mueve la
// opacidad del fondo de vidrio via la variable CSS --opacidad-ventana.
const btnOpciones = $('btnOpciones');
const panelOpciones = $('panelOpciones');
const rangoTransparencia = $('rangoTransparencia');
const valorTransparencia = $('valorTransparencia');

btnOpciones.addEventListener('click', (e) => {
  e.stopPropagation();
  panelOpciones.classList.toggle('oculto');
});
document.addEventListener('click', (e) => {
  if (!panelOpciones.classList.contains('oculto') && !panelOpciones.contains(e.target) && e.target !== btnOpciones) {
    panelOpciones.classList.add('oculto');
  }
});
function aplicarTransparencia(valor) {
  const opacidad = Number(valor) / 100;
  document.documentElement.style.setProperty('--opacidad-ventana', opacidad.toFixed(2));
  valorTransparencia.textContent = `${valor}%`;
}
rangoTransparencia.addEventListener('input', () => aplicarTransparencia(rangoTransparencia.value));
// El guardado a disco se hace en "change" (al soltar el mouse/tecla), no en
// cada "input" mientras se arrastra, para no escribir el archivo de
// configuracion decenas de veces por segundo.
rangoTransparencia.addEventListener('change', () => {
  window.api.guardarTransparencia(Number(rangoTransparencia.value));
});

// Desenfoque: 3 niveles fijos que van directo al material nativo de Windows
// (backgroundMaterial), no a un backdrop-filter de CSS (ver comentarios en
// main.js sobre por que la barra continua de px no servia de nada).
const filaNivelBlur = $('filaNivelBlur');
const botonesNivelBlur = Array.from(filaNivelBlur.querySelectorAll('.btn-nivel-blur'));

function marcarNivelBlurActivo(nivel) {
  for (const boton of botonesNivelBlur) {
    boton.classList.toggle('activo', boton.dataset.nivel === nivel);
  }
}

filaNivelBlur.addEventListener('click', async (e) => {
  const boton = e.target.closest('.btn-nivel-blur');
  if (!boton) return;
  const nivelAplicado = await window.api.establecerNivelDesenfoque(boton.dataset.nivel);
  marcarNivelBlurActivo(nivelAplicado);
});

// El main process resuelve la configuracion guardada (con fallback de nivel
// de desenfoque si el build de Windows no lo soporta) y la manda aca al
// cargar, para que la ventana arranque igual a como quedo la ultima vez.
window.api.onConfiguracionInicial(({ transparencia, nivelDesenfoque }) => {
  if (transparencia !== undefined && transparencia !== null) {
    rangoTransparencia.value = transparencia;
    aplicarTransparencia(transparencia);
  }
  marcarNivelBlurActivo(nivelDesenfoque);
});

$('btnMin').addEventListener('click', () => window.api.minimizarVentana());
$('btnClose').addEventListener('click', () => window.api.cerrarVentana());
$('btnSalir').addEventListener('click', () => window.api.cerrarVentana());

$('lnkCredito').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.abrirEnlaceExterno('https://t.me/xSHIMURAx');
});

// ---- Botones ----

$('btnCarpeta').addEventListener('click', async () => {
  const carpeta = await window.api.elegirCarpeta();
  if (carpeta) {
    imagenes = [];
    carpetaBase = null;
    seleccionIndice = -1;
    fuentesAgregadas.clear();
    fuentesOriginales = [];
    await agregarRutas([carpeta]);
  }
});

$('btnAgregarCarpeta').addEventListener('click', async () => {
  const rutas = await window.api.elegirImagenesOCarpetas();
  await agregarRutas(rutas);
});

$('btnSubir').addEventListener('click', () => {
  if (seleccionIndice <= 0) return;
  [imagenes[seleccionIndice - 1], imagenes[seleccionIndice]] = [imagenes[seleccionIndice], imagenes[seleccionIndice - 1]];
  seleccionIndice -= 1;
  renderizarLista();
});

$('btnBajar').addEventListener('click', () => {
  if (seleccionIndice < 0 || seleccionIndice >= imagenes.length - 1) return;
  [imagenes[seleccionIndice + 1], imagenes[seleccionIndice]] = [imagenes[seleccionIndice], imagenes[seleccionIndice + 1]];
  seleccionIndice += 1;
  renderizarLista();
});

$('btnQuitar').addEventListener('click', () => {
  if (seleccionIndice < 0) return;
  imagenes.splice(seleccionIndice, 1);
  seleccionIndice = -1;
  actualizarContador();
  renderizarLista();
});

$('btnQuitarTodo').addEventListener('click', () => {
  imagenes = [];
  seleccionIndice = -1;
  carpetaBase = null;
  fuentesAgregadas.clear();
  fuentesOriginales = [];
  txtCarpeta.value = '';
  txtNombrePDF.value = '';
  actualizarContador();
  renderizarLista();
  setEstado('Lista vaciada.');
});

$('btnMiniaturas').addEventListener('click', () => {
  modoMiniaturas = !modoMiniaturas;
  listaImagenes.classList.toggle('oculto', modoMiniaturas);
  gridMiniaturas.classList.toggle('oculto', !modoMiniaturas);
  $('btnMiniaturas').textContent = modoMiniaturas ? 'Lista' : 'Miniaturas';
  renderizarLista();
});

// El relleno del slider se pinta a mano con una capa de color solido
// recortada al ancho exacto del valor actual via background-size (en vez
// de un degradado con corte duro en el mismo fondo, que dejaba una linea
// de mezcla/antialiasing visible justo en el borde del relleno); el track
// nativo queda transparente para dejarlo ver (ver .fila-calidad
// input[type="range"] en styles.css).
function actualizarRellenoCalidad() {
  const min = Number(rangoCalidad.min) || 0;
  const max = Number(rangoCalidad.max) || 100;
  const porcentaje = ((rangoCalidad.value - min) / (max - min)) * 100;
  rangoCalidad.style.background =
    `linear-gradient(#228be6, #228be6) 0 / ${porcentaje}% 100% no-repeat, rgba(255, 255, 255, 0.15)`;
}
rangoCalidad.addEventListener('input', () => {
  valorCalidad.textContent = rangoCalidad.value;
  actualizarRellenoCalidad();
});
actualizarRellenoCalidad();

$('btnRutaSalida').addEventListener('click', async () => {
  const carpeta = await window.api.elegirCarpetaSalida();
  if (carpeta) txtRutaSalida.value = carpeta;
});

let convirtiendo = false;

$('btnConvertir').addEventListener('click', async () => {
  if (convirtiendo) {
    // El boton esta en modo "Cancelar": pide al proceso principal que
    // detenga la conversion en curso en la proxima imagen que procese.
    window.api.cancelarConversion();
    $('btnConvertir').disabled = true;
    $('btnConvertir').textContent = 'Cancelando...';
    return;
  }

  if (imagenes.length === 0) {
    setEstado('No hay imagenes para convertir.', 'error');
    return;
  }
  barraProgresoRelleno.style.width = '0%';
  setEstado('Convirtiendo, por favor espera...');
  convirtiendo = true;
  $('btnConvertir').textContent = 'Cancelar';
  $('btnConvertir').classList.add('cancelar');
  try {
    const rutaFinal = await window.api.convertirAPdf({
      imagenes,
      calidad: parseInt(rangoCalidad.value, 10),
      nombrePDF: txtNombrePDF.value,
      carpetaSalida: txtRutaSalida.value,
      carpetaBase,
    });
    setEstado('✓ PDF generado correctamente', 'exito');
    reproducirSonidoExito();
    barraProgresoRelleno.style.width = '100%';
  } catch (err) {
    if (err && err.message && err.message.includes('CANCELADO_POR_USUARIO')) {
      setEstado('Conversion cancelada.');
      barraProgresoRelleno.style.width = '0%';
    } else {
      setEstado('Error al crear el PDF: ' + err.message, 'error');
    }
  } finally {
    convirtiendo = false;
    $('btnConvertir').disabled = false;
    $('btnConvertir').textContent = 'Convertir a PDF';
    $('btnConvertir').classList.remove('cancelar');
  }
});

window.api.onProgresoPdf(({ actual, total, texto }) => {
  setEstado(texto);
  barraProgresoRelleno.style.width = `${Math.round((actual / total) * 100)}%`;
});

// Abrir con / drag&drop desde el explorador (carpeta o imagenes sueltas)
window.api.onRutasIniciales((rutas) => { agregarRutas(rutas); });

// Arrastrar y soltar archivos directo sobre la ventana
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const rutas = Array.from(e.dataTransfer.files).map((f) => f.path);
  agregarRutas(rutas);
});

actualizarContador();
renderizarLista();
