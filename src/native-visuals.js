// Reimplementacion en Node/Electron del truco de "acrilico" que usaba
// ConvertidorPDF.ps1 via P/Invoke a user32.dll (SetWindowCompositionAttribute,
// ver la clase NativeVisuals en el .ps1 original).
//
// Por que hace falta esto y no alcanza con backgroundMaterial:'acrylic' de
// Electron (ver main.js): esa opcion nativa de Electron solo funciona en
// Windows 11 22H2 en adelante; en Windows 10 (donde SI funcionaba la version
// PowerShell, porque llamaba directo a la API de Windows) Electron cae en un
// fondo solido sin blur. Esto restaura el mismo nivel de compatibilidad que
// tenia la version compilada con ps2exe.
//
// Se usa "koffi" (https://koffi.dev) en vez de ffi-napi/ref-napi porque esta
// compilado sobre Node-API (N-API): no necesita reconstruirse contra el ABI
// especifico de Electron (nada de "npx electron-rebuild") ni herramientas de
// compilacion nativa (node-gyp/Visual Studio Build Tools) en la maquina del
// que compila la app. Eso importa porque el motivo por el que la version
// Electron dejo de depender de un magick.exe externo fue justamente evitar
// binarios adicionales que dispararan falsos positivos de antivirus (ver
// README) — koffi es un paquete npm normal con binarios precompilados
// firmados, no un ejecutable que la app descarga o invoca por su cuenta.

const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4; // igual valor que en el .ps1
const WCA_ACCENT_POLICY = 19; // igual valor que en el .ps1

let koffi = null;
let SetWindowCompositionAttribute = null;
let inicializacionFallo = false;

function inicializar() {
  if (SetWindowCompositionAttribute) return true;
  if (inicializacionFallo) return false;
  if (process.platform !== 'win32') { inicializacionFallo = true; return false; }

  try {
    koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    // Mismos dos structs que ACCENT_POLICY / WINDOWCOMPOSITIONATTRIBUTEDATA
    // del .ps1. Declarar el campo "Data" como puntero a ACCENT_POLICY (en vez
    // de "void *" generico) le permite a koffi calcular el tamaño/alineacion
    // correctos por arquitectura y, al llamar la funcion, aceptar un objeto
    // JS comun ahi mismo (reserva memoria y lo copia automaticamente) en vez
    // de tener que armar el puntero a mano como hacia el .ps1 con
    // Marshal.AllocHGlobal/StructureToPtr.
    koffi.struct('ACCENT_POLICY', {
      AccentState: 'int32',
      AccentFlags: 'int32',
      GradientColor: 'uint32',
      AnimationId: 'int32',
    });
    koffi.struct('WINCOMPATTRDATA', {
      Attribute: 'int32',
      Data: 'ACCENT_POLICY *',
      SizeOfData: 'int32',
    });

    SetWindowCompositionAttribute = user32.func(
      '__stdcall',
      'SetWindowCompositionAttribute',
      'int',
      ['void *', 'WINCOMPATTRDATA *']
    );
    return true;
  } catch (err) {
    console.warn('[native-visuals] No se pudo inicializar koffi/user32.dll (se sigue sin el acrilico nativo):', err.message);
    inicializacionFallo = true;
    SetWindowCompositionAttribute = null;
    return false;
  }
}

// getNativeWindowHandle() de Electron devuelve el HWND como los bytes crudos
// del puntero (8 bytes en Windows de 64 bits, 4 en 32 bits), igual concepto
// que $form.Handle en WinForms pero sin envoltorio .NET.
function obtenerHwnd(ventana) {
  const buffer = ventana.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

/**
 * Aplica (o vuelve a aplicar) el efecto acrilico sobre una BrowserWindow.
 * @param {Electron.BrowserWindow} ventana
 * @param {{r:number,g:number,b:number}} tinte   Color base (0-255 cada canal), igual que $colTint en el .ps1.
 * @param {number} transparencia  0 (opaco) a 100 (maxima transparencia/blur). 69 ≈ el alpha=80/255 fijo que usaba el .ps1.
 * @returns {boolean} true si se pudo aplicar (false en cualquier plataforma que no sea Windows, o si algo fallo).
 */
function aplicarAcrilico(ventana, tinte, transparencia) {
  if (!inicializar()) return false;
  if (!ventana || ventana.isDestroyed()) return false;

  try {
    const alpha = Math.round(255 * (1 - Math.max(0, Math.min(100, transparencia)) / 100));
    // ABGR empaquetado en un uint32, igual que "(a << 24) | (b << 16) | (g << 8) | r" en el .ps1.
    const gradientColor = ((alpha & 0xff) << 24) | ((tinte.b & 0xff) << 16) | ((tinte.g & 0xff) << 8) | (tinte.r & 0xff);

    const resultado = SetWindowCompositionAttribute(obtenerHwnd(ventana), {
      Attribute: WCA_ACCENT_POLICY,
      Data: {
        AccentState: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        AccentFlags: 0,
        GradientColor: gradientColor >>> 0,
        AnimationId: 0,
      },
      SizeOfData: 16, // sizeof(ACCENT_POLICY): 4 campos int32/uint32
    });

    return resultado === 1; // SetWindowCompositionAttribute devuelve TRUE (1) si tuvo exito
  } catch (err) {
    console.warn('[native-visuals] No se pudo aplicar el acrilico:', err.message);
    return false;
  }
}

module.exports = {
  aplicarAcrilico,
  disponibleEnEstaPlataforma: () => process.platform === 'win32',
};
