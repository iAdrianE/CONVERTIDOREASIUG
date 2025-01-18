import JSZip from "jszip";
import fs from "fs-extra";
import archiver from "archiver";
import path from "path";
import { exec } from "child_process";

export const processImages = async (filePath, outputDir, zipPath) => {
  try {
    // Extraer imágenes usando Pandoc
    const pandocCommand = `pandoc "${filePath}" -f docx -t html --extract-media="${outputDir}"`;
    console.log(`Comando ejecutado: ${pandocCommand}`); // Registro para depurar
    await new Promise((resolve, reject) => {
      exec(pandocCommand, (error) => {
        if (error) return reject(`Error ejecutando Pandoc: ${error.message}`);
        resolve();
      });
    });

    // Extraer imágenes adicionales directamente a la raíz (sin carpeta media)
    const docxContent = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(docxContent);
    const mediaFiles = Object.keys(zip.files).filter((fileName) =>
      fileName.startsWith("word/media/")
    );

    // Procesar las imágenes
    for (const fileName of mediaFiles) {
      const mediaFileName = path.basename(fileName);
      const imagePath = path.join(outputDir, mediaFileName);  // Guardamos las imágenes en la raíz de outputDir
      try {
        if (!(await fs.pathExists(imagePath))) {
          const imageBuffer = await zip.file(fileName).async("nodebuffer");
          await fs.writeFile(imagePath, imageBuffer);
        }
      } catch (error) {
        // Registrar el error y continuar con el siguiente archivo
        console.error(`Error al procesar la imagen ${mediaFileName}: ${error.message}`);
      }
    }

    // Crear ZIP con las imágenes en la raíz, incluida la carpeta media
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip");
    archive.pipe(output);
    archive.directory(outputDir, false); // Comprimir solo el contenido de outputDir
    await archive.finalize();

    console.log(`Archivo ZIP de imágenes generado en: ${zipPath}`);

    // Ahora, vamos a eliminar la carpeta 'media' del ZIP
    const zipContent = await fs.readFile(zipPath);
    const newZip = await JSZip.loadAsync(zipContent);
    
    // Eliminar la carpeta 'media' dentro del archivo ZIP
    delete newZip.files['media/'];

    // Guardar el nuevo ZIP sin la carpeta 'media'
    const cleanedZipPath = zipPath.replace(".zip", "_cleaned.zip");
    const newOutput = fs.createWriteStream(cleanedZipPath);
    const cleanedArchive = archiver("zip");
    cleanedArchive.pipe(newOutput);
    
    // Añadir los archivos restantes al nuevo archivo ZIP
    for (const fileName in newZip.files) {
      const file = newZip.files[fileName];
      const buffer = await file.async("nodebuffer");
      cleanedArchive.append(buffer, { name: fileName });
    }
    
    await cleanedArchive.finalize();
    console.log(`Archivo ZIP limpio (sin la carpeta 'media') generado en: ${cleanedZipPath}`);

    // Opcional: Reemplazar el archivo original ZIP con el limpiado
    await fs.remove(zipPath);  // Eliminar el archivo ZIP original con 'media'
    await fs.rename(cleanedZipPath, zipPath);  // Renombrar el archivo limpio como el original

    return zipPath;  // Devolver la ruta del archivo ZIP final limpio
  } catch (error) {
    throw new Error(`Error al procesar imágenes: ${error.message}`);
  }
};
