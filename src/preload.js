const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  elegirCarpeta: () => ipcRenderer.invoke('dialog:elegirCarpeta'),
  elegirImagenesOCarpetas: () => ipcRenderer.invoke('dialog:elegirImagenesOCarpetas'),
  elegirCarpetaSalida: () => ipcRenderer.invoke('dialog:elegirCarpetaSalida'),
  abrirCarpetaEnExplorador: (ruta) => ipcRenderer.invoke('shell:abrirCarpeta', ruta),
  abrirArchivoConVisorPredeterminado: (ruta) => ipcRenderer.invoke('shell:abrirArchivo', ruta),

  resolverRutas: (rutas, recursivo) => ipcRenderer.invoke('imagenes:resolverRutas', rutas, recursivo),
  obtenerMiniatura: (ruta) => ipcRenderer.invoke('imagenes:miniatura', ruta),

  convertirAPdf: (payload) => ipcRenderer.invoke('pdf:convertir', payload),
  cancelarConversion: () => ipcRenderer.send('pdf:cancelar'),
  onProgresoPdf: (callback) => ipcRenderer.on('pdf:progreso', (_e, data) => callback(data)),

  onRutasIniciales: (callback) => ipcRenderer.on('app:rutas-iniciales', (_e, rutas) => callback(rutas)),

  // Desenfoque nativo de la ventana: niveles fijos en la UI ('ninguno'|'acrilico').
  // Devuelve el nivel realmente aplicado (puede haber fallback si el build
  // de Windows no soporta el pedido; en otras plataformas siempre 'ninguno').
  establecerNivelDesenfoque: (nivel) => ipcRenderer.invoke('window:establecerNivelDesenfoque', nivel),

  // Configuracion persistente (transparencia + desenfoque): se guarda en
  // disco en el proceso principal y se vuelve a aplicar sola la proxima
  // vez que se abra la app.
  guardarTransparencia: (valor) => ipcRenderer.send('config:guardarTransparencia', valor),
  onConfiguracionInicial: (callback) => ipcRenderer.on('app:configuracion-inicial', (_e, config) => callback(config)),

  // Barra de titulo custom (la ventana es frame:false para poder ser transparente/acrilica)
  minimizarVentana: () => ipcRenderer.send('window:minimizar'),
  cerrarVentana: () => ipcRenderer.send('window:cerrar'),

  // Enlaces externos (ej. credito de Telegram): se abren en el navegador
  // del sistema, nunca dentro de la propia ventana de la app.
  abrirEnlaceExterno: (url) => ipcRenderer.send('shell:abrirExterno', url),
});
