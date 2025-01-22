import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer"; // Para manejar archivos subidos.
import fs from "fs-extra"; // Para manejar archivos.
import { exec } from "child_process"; // Para ejecutar comandos del sistema.
import xmlbuilder from "xmlbuilder"; // Para generar XML.
import JSZip from "jszip"; // Para manejar archivos DOCX como ZIP.
import archiver from "archiver"; // Para crear archivos ZIP.
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { methods as authentication } from "./controllers/authentication.controller.js";
import { methods as authorization } from "./middlewares/authorization.js";

// Configuración para multer.
const upload = multer({ dest: "uploads/" });
const UPLOAD_DIR = "uploads";

// Crear servidor.
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

// Rutas públicas.
app.get("/", authorization.soloPublico, (req, res) =>
  res.sendFile(path.join(__dirname, "paginas/login.html"))
);
app.get("/register", authorization.soloPublico, (req, res) =>
  res.sendFile(path.join(__dirname, "paginas/register.html"))
);
app.get("/convertidor", authorization.soloConvertidor, (req, res) =>
  res.sendFile(path.join(__dirname, "paginas/convertidor/convertidor.html"))
);
app.post("/api/login", authentication.login);
app.post("/api/register", authentication.register);

// Ruta para subir y procesar archivos
app.post("/api/convertir", upload.single("file"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send("No se recibió ningún archivo.");
  }

  try {
    const originalFilename = path.parse(file.originalname).name;
    const outputHtmlPath = path.join(UPLOAD_DIR, `${originalFilename}.html`);
    const cleanedHtmlPath = path.join(UPLOAD_DIR, `${originalFilename}_cleaned.html`);

    // Convertir archivo DOCX a HTML usando Pandoc.
    const pandocCommand = `pandoc "${file.path}" -f docx -t html -o "${outputHtmlPath}"`;
    exec(pandocCommand, async (error) => {
      if (error) {
        console.error("Error ejecutando Pandoc:", error);
        return res.status(500).send("Error al procesar el archivo con Pandoc.");
      }

      try {
        // Leer contenido HTML generado
        const htmlContent = await fs.readFile(outputHtmlPath, "utf8");

        // Limpiar y optimizar el HTML
        const cleanedHtml = cleanAndOptimizeHtml(htmlContent);

        // Guardar el HTML limpio
        await fs.writeFile(cleanedHtmlPath, cleanedHtml, "utf8");

        // Extraer secciones y palabras clave
        const { sections, keywords } = parseArticleSections(cleanedHtml);

        // Generar XML JATS
        const jatsXml = generateJATSFromArticle(sections, keywords);

        // Guardar XML
        const xmlPath = path.join(UPLOAD_DIR, `${originalFilename}.xml`);
        await fs.writeFile(xmlPath, jatsXml, "utf8");

        // Configurar respuesta
        res.status(200).json({
          message: "Archivo procesado exitosamente.",
          xmlDownloadUrl: `/download/xml/${originalFilename}.xml`,
          cleanedHtmlDownloadUrl: `/download/html/${originalFilename}_cleaned.html`,
        });

        // Limpieza de archivos temporales
        await fs.unlink(file.path);
        await fs.unlink(outputHtmlPath);
      } catch (processingError) {
        console.error("Error al procesar el archivo:", processingError);
        res.status(500).send("Error al procesar el archivo.");
      }
    });
  } catch (error) {
    console.error("Error al procesar el archivo:", error);
    res.status(500).send("Error al procesar el archivo.");
  }
});

// Función para limpiar y optimizar HTML
const cleanAndOptimizeHtml = (htmlContent) => {
  const $ = cheerio.load(htmlContent);

  // Eliminar estilos en línea innecesarios
  $("*").removeAttr("style");

  // Eliminar etiquetas vacías
  $("p, div, span").each((_, elem) => {
    if ($(elem).text().trim() === "") {
      $(elem).remove();
    }
  });

  return $.html();
};

// Función para extraer secciones por palabras clave
const parseArticleSections = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  const sections = [];
  let keywords = [];

  // Palabras clave por sección
  const sectionKeywords = {
    Abstract: ["Abstract", "Resumen"],
    Keywords: ["Keywords", "Palabras clave"],
    Introduction: ["Introduction", "Introducción"],
    Methods: ["Materials and Methods", "Methodology", "Métodos"],
    Results: ["Results and Discussion", "Results", "Resultados"],
    Conclusions: ["Conclusions", "Conclusiones"],
    Acknowledgements: ["Acknowledgements", "Agradecimientos"],
  };

  // Buscar sección por palabras clave
  const findSectionByKeyword = (keywordsArray) => {
    for (const keyword of keywordsArray) {
      const sectionContent = $(`p:contains('${keyword}')`).text().trim();
      if (sectionContent) return sectionContent; // Retorna el contenido encontrado
    }
    return null;
  };

  // Abstract
  const abstractContent = findSectionByKeyword(sectionKeywords.Abstract);
  if (abstractContent) {
    sections.push({ title: "Abstract", content: abstractContent });
  }

  // Keywords
  const keywordsContent = findSectionByKeyword(sectionKeywords.Keywords);
  if (keywordsContent) {
    keywords = keywordsContent
      .replace(/(Keywords:|Palabras clave:)/i, "")
      .split(",")
      .map((kw) => kw.trim());
  }

  // Secciones principales
  for (const [title, keywordsArray] of Object.entries(sectionKeywords)) {
    if (title === "Abstract" || title === "Keywords") continue; // Ya procesados
    const sectionContent = findSectionByKeyword(keywordsArray);
    if (sectionContent) {
      sections.push({ title, content: sectionContent });
    }
  }

  return { sections, keywords };
};

// Función para generar XML JATS
const generateJATSFromArticle = (sections, keywords) => {
  const xml = xmlbuilder
    .create("article", { version: "1.0", encoding: "UTF-8" })
    .att("xmlns", "http://www.ncbi.nlm.nih.gov/JATS1")
    .att("dtd-version", "1.1d1");

  const front = xml.ele("front").ele("article-meta");

  // Abstract
  const abstract = sections.find((sec) => sec.title === "Abstract");
  if (abstract) {
    front.ele("abstract").ele("p", abstract.content);
  }

  // Keywords
  if (keywords.length > 0) {
    const kwdGroup = front.ele("kwd-group");
    keywords.forEach((kw) => kwdGroup.ele("kwd", kw));
  }

  // Cuerpo del artículo
  const body = xml.ele("body");
  sections.forEach((section) => {
    if (section.title !== "Abstract") {
      const sec = body.ele("sec");
      sec.ele("title", section.title);
      sec.ele("p", section.content);
    }
  });

  return xml.end({ pretty: true });
};

// Endpoints para descarga.
app.get("/download/xml/:filename", async (req, res) => {
  try {
    const xmlPath = path.join(UPLOAD_DIR, req.params.filename);
    const originalFilename = req.params.filename.replace(".xml", "");

    res.download(xmlPath, `${originalFilename}.xml`, async (err) => {
      if (err) {
        console.error("Error al descargar XML:", err);
        return res.status(500).send("Error al descargar XML.");
      }

      try {
        await fs.unlink(xmlPath);
      } catch (cleanupErr) {
        console.error("Error eliminando XML:", cleanupErr);
      }
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo XML:", error);
    res.status(500).send("Error interno.");
  }
});

app.get("/download/images/:filename", async (req, res) => {
  try {
    const zipPath = path.join(UPLOAD_DIR, req.params.filename);

    res.download(zipPath, req.params.filename, async (err) => {
      if (err) {
        console.error("Error al descargar imágenes ZIP:", err);
        return res.status(500).send("Error al descargar imágenes ZIP.");
      }

      try {
        await fs.unlink(zipPath);
      } catch (cleanupErr) {
        console.error("Error eliminando ZIP de imágenes:", cleanupErr);
      }
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo ZIP de imágenes:", error);
    res.status(500).send("Error interno.");
  }
});

// Endpoint para descargar HTML limpio
app.get("/download/html/:filename", async (req, res) => {
  try {
    const htmlPath = path.join(UPLOAD_DIR, req.params.filename);
    const originalFilename = req.params.filename.replace(".html", ""); // Nombre base para el archivo

    // Descargar el archivo HTML limpio
    res.download(htmlPath, `${originalFilename}_cleaned.html`, async (err) => {
      if (err) {
        console.error("Error al descargar HTML:", err);
        return res.status(500).send("Error al descargar el HTML.");
      }

      // Eliminar el archivo HTML después de la descarga
      try {
        await fs.unlink(htmlPath);
        console.log(`HTML eliminado: ${htmlPath}`);
      } catch (cleanupErr) {
        console.error("Error eliminando HTML:", cleanupErr);
      }
    });
  } catch (error) {
    console.error("Error al iniciar la descarga del archivo HTML:", error);
    res.status(500).send("Error al iniciar la descarga del HTML.");
  }
});
