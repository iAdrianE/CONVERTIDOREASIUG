// Importaciones iniciales
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer"; // Para manejar archivos subidos.
import fs from "fs-extra"; // Para manejar archivos.
import AdmZip from "adm-zip";
import path from "path";
import { fileURLToPath } from "url";
import { processImages } from "./modules/imageprocessor.js"; // Módulo de procesamiento de imágenes
import { processResearchArticle } from "./modules/templatehandlers/researcharticlehandler.js"; // Módulo para artículos originales
import { processResearchLetter } from "./modules/templatehandlers/researchletterhandler.js"; // Módulo para informes breves y cartas
import { processReviewArticle } from "./modules/templatehandlers/sotareviewhandler.js"; // Módulo para resenas
import { methods as authentication } from "./controllers/authentication.controller.js";
import { methods as authorization } from "./middlewares/authorization.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuración para multer
const upload = multer({ dest: "uploads/" });
const UPLOAD_DIR = "uploads";

// Crear servidor
const app = express();
app.set("port", 3000);

// Función para limpiar archivos viejos.
const cleanOldFiles = async (dir, ageInMinutes) => {
  const files = await fs.readdir(dir);
  const now = Date.now();

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = await fs.stat(filePath);
    const fileAge = (now - stats.mtimeMs) / 60000;

    if (fileAge > ageInMinutes) {
      try {
        if (stats.isDirectory()) {
          await fs.remove(filePath);
          console.log(`Carpeta eliminada: ${filePath}`);
        } else {
          await fs.unlink(filePath);
          console.log(`Archivo eliminado: ${filePath}`);
        }
      } catch (err) {
        console.error(`Error al eliminar ${filePath}:`, err);
      }
    }
  }
};

// Limpieza inicial al iniciar el servidor.
app.listen(app.get("port"), '0.0.0.0', async () => {
  console.log("Servidor corriendo en puerto", app.get("port"));
  try {
    if (await fs.pathExists(UPLOAD_DIR)) {
      console.log("Carpeta uploads detectada, iniciando limpieza...");
      await cleanOldFiles(UPLOAD_DIR, 15);
    } else {
      console.log("Carpeta uploads no encontrada. Creándola...");
      await fs.ensureDir(UPLOAD_DIR);
    }
  } catch (err) {
    console.error("Error al limpiar archivos viejos al inicio:", err);
  }
});

// Limpieza periódica cada 3 minutos.
setInterval(async () => {
  console.log("Iniciando limpieza periódica...");
  try {
    await cleanOldFiles(UPLOAD_DIR, 5);
    console.log("Limpieza periódica completada.");
  } catch (err) {
    console.error("Error durante la limpieza periódica:", err);
  }
}, 3 * 60 * 1000);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(cookieParser());

// Rutas públicas (incluye login y registro)
// app.get("/", authorization.soloPublico, (req, res) =>
//   res.sendFile(path.join(__dirname, "paginas/login.html"))
// );
// app.get("/register", authorization.soloPublico, (req, res) =>
//   res.sendFile(path.join(__dirname, "paginas/register.html"))
// );
app.get("/", authorization.soloConvertidor, (req, res) =>
  res.sendFile(path.join(__dirname, "paginas/convertidor/convertidor.html"))
);

app.post("/api/login", authentication.login);
app.post("/api/register", authentication.register);

// Función para limpiar imágenes duplicadas, preservando solo las imágenes dentro de 'media'
async function cleanDuplicateImages(imagesFolder) {
  const mediaFolder = path.join(imagesFolder, 'media');

  if (await fs.pathExists(mediaFolder)) {
    const rootImages = await fs.readdir(imagesFolder); // Lista de archivos en la raíz de la carpeta de imágenes

    for (const file of rootImages) {
      const filePath = path.join(imagesFolder, file);
      if (file !== 'media' && !(await fs.stat(filePath)).isDirectory()) {
        await fs.remove(filePath); // Elimina cualquier archivo que no esté en 'media'
        console.log(`Imagen eliminada fuera de 'media': ${filePath}`);
      }
    }
  }
}


// Endpoint para subir y procesar archivos
app.post("/api/convertir", upload.single("file"), async (req, res) => {
  const file = req.file;
  const template = req.body.template || "default"; // Plantilla seleccionada manualmente

  if (!file) {
    return res.status(400).send("No se recibió ningún archivo.");
  }

  console.log(`Procesando archivo con plantilla: ${template}`);

  try {
    const originalFilename = path.parse(file.originalname).name;
    const outputDir = path.join(UPLOAD_DIR, originalFilename);

    // Define carpeta media específica dentro de outputDir
    const mediaFolder = path.join(outputDir, 'media');
    const zipPath = path.join(UPLOAD_DIR, `${originalFilename}_images.zip`);

    // Procesar imágenes y generar ZIP usando el módulo
    await processImages(file.path, mediaFolder, zipPath);

    // Limpia imágenes duplicadas
    await cleanDuplicateImages(outputDir);

    let result;
    switch (template) {
      case "research-article": // Artículo original
        result = await processResearchArticle(file.path, outputDir);
        break;
      case "research-letter": // Informe breve o carta
      result = await processResearchLetter(file.path, outputDir);
      break;
      case "review": // Reseñas
      result = await processReviewArticle(file.path, outputDir);
        break;
      default:
        throw new Error("Plantilla no soportada.");
    }

    // Mover archivos generados a la carpeta uploads
    const finalXmlPath = path.join(UPLOAD_DIR, `${originalFilename}.xml`);
    const finalHtmlPath = path.join(UPLOAD_DIR, `${originalFilename}.html`);
    await fs.move(result.xmlPath, finalXmlPath, { overwrite: true });
    await fs.move(result.cleanedHtmlPath, finalHtmlPath, { overwrite: true });

    // Respuesta con rutas para XML e imágenes
    res.status(200).json({
      message: "Archivo procesado exitosamente.",
      xmlDownloadUrl: `/download/xml/${path.basename(finalXmlPath)}`,
      cleanedHtmlDownloadUrl: `/download/html/${path.basename(finalHtmlPath)}`,
      imagesDownloadUrl: `/download/images/${path.basename(zipPath)}`,
    });

    // Limpieza de archivos temporales
    await fs.unlink(file.path);
    await fs.remove(outputDir); // Elimina toda la carpeta temporal
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    res.status(500).send("Error al procesar el archivo.");
  }
});

// Endpoint de descarga de imágenes permanece igual
app.get("/download/images/:filename", async (req, res) => {
  try {
    const zipPath = path.join(UPLOAD_DIR, req.params.filename);

    // Abrir el archivo ZIP
    const zip = new AdmZip(zipPath);

    // Eliminar la carpeta "media" dentro del ZIP
    const zipEntries = zip.getEntries();
    zipEntries.forEach((entry) => {
      if (entry.entryName.startsWith('media/')) {
        zip.deleteFile(entry.entryName); // Eliminar todos los archivos dentro de "media"
      }
    });

    // Crear un nuevo archivo ZIP sin la carpeta "media"
    const modifiedZipPath = path.join(UPLOAD_DIR, `modified_${req.params.filename}`);
    zip.writeZip(modifiedZipPath);

    // Iniciar la descarga del ZIP modificado
    res.download(modifiedZipPath, req.params.filename, async (err) => {
      if (err) {
        console.error("Error al descargar imágenes ZIP:", err);
        return res.status(500).send("Error al descargar imágenes ZIP.");
      }

      try {
        // Eliminar el archivo ZIP modificado y el original
        await fs.unlink(zipPath);
        await fs.unlink(modifiedZipPath);
      } catch (cleanupErr) {
        console.error("Error eliminando ZIP de imágenes:", cleanupErr);
      }
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo ZIP de imágenes:", error);
    res.status(500).send("Error interno.");
  }
});


// Endpoints de descarga de HTML y XML.
app.get("/download/html/:filename", async (req, res) => {
  try {
    const htmlPath = path.join(UPLOAD_DIR, req.params.filename);
    res.download(htmlPath, req.params.filename, async (err) => {
      if (err) {
        console.error("Error al descargar HTML:", err);
        return res.status(500).send("Error al descargar el HTML.");
      }
      await fs.unlink(htmlPath);
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo HTML:", error);
    res.status(500).send("Error interno.");
  }
});

app.get("/download/xml/:filename", async (req, res) => {
  try {
    const xmlPath = path.join(UPLOAD_DIR, req.params.filename);
    res.download(xmlPath, req.params.filename, async (err) => {
      if (err) {
        console.error("Error al descargar XML:", err);
        return res.status(500).send("Error al descargar XML.");
      }
      await fs.unlink(xmlPath);
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo XML:", error);
    res.status(500).send("Error interno.");
  }
});
