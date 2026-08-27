// Convertidor a PDF - lanza la app propia (PDF Creator) 
// Aparece como apartado propio en el menu contextual, junto a FFmpeg e ImageMagick.

item(title='Convertir a PDF...' type='file|dir|back.dir' mode='multiple' image=image.res('C:\Program Files\PDF Creator\PDF Creator.exe', 0)
	tip='Convierte imagenes seleccionadas a un unico PDF con la app Convertidor a PDF'
	cmd='C:\Program Files\PDF Creator\PDF Creator.exe' arg=sel(true," "))
