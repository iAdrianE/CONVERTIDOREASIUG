import fs from "fs-extra";
import path from "path";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import xmlbuilder from "xmlbuilder";
import { decode } from "html-entities";

export const processResearchArticle = async (filePath, outputDir) => {
  try {
    // Nombre base del documento (sin extensión)
    const originalFilename = path.parse(filePath).name;

    // Rutas para archivos y carpetas
    const imagesFolder = path.join(outputDir, `${originalFilename}_images`);
    const cleanedHtmlPath = path.join(outputDir, `${originalFilename}.html`);
    const xmlPath = path.join(outputDir, `${originalFilename}.xml`);

    await fs.ensureDir(imagesFolder);
    await fs.ensureDir(outputDir);

    // Convertir DOCX a HTML usando mammoth.js
    const docxBuffer = await fs.readFile(filePath);
    const { value: rawHtml, messages } = await mammoth.convertToHtml(docxBuffer, {
      styleMap: [
        "p[style-name='Título 1'] => h1:fresh",  // Añadir esta línea para mapear "Título 1" a <h1>
        "p[style-name='Título 2'] => h2:fresh",  // Por si también se usan otros estilos.
        "p[style-name='Título 3'] => h3:fresh",  // mapeo para Título 3
        "p[style-name='Título 4'] => h4:fresh",  // Mapeo para Título 4 
        "p[style-name='Título 5'] => h5:fresh",  // Mapeo para Título 5
        "p[style-name='Autores'] => p.authors",  // 'Autores' mapeado como párrafo con clase 'authors'
        "p[style-name='Afiliaciones'] => p.affiliations",  // 'Afiliaciones' mapeado como párrafo con clase 'affiliations'
        "p[style-name='Boxed Text'] => p.boxedtext",  // Boxed Text
      ],    
      convertImage: mammoth.images.inline((element) => {
        const mediaFolder = path.join(outputDir, 'media');  // Define la carpeta "media" directamente
        const imageFileName = `image${String(element.index + 1).padStart(3, '0')}.png`;
        const imageFilePath = path.join(mediaFolder, imageFileName);  // Ruta dentro de "media"
      
        fs.ensureDirSync(mediaFolder);  // Asegúrate de que la carpeta "media" existe
      
        return element.read("base64").then((imageBuffer) => {
          fs.writeFileSync(imageFilePath, imageBuffer, "base64");  // Guardar imagen directamente en "media"
          return { src: `media/${imageFileName}` };  // Referencia correcta para el XML
        });
      }),         
    });

    messages.forEach((msg) => console.warn(msg)); // Registrar mensajes de advertencia de mammoth.js

    const cleanedHtml = cleanAndOptimizeHtml(rawHtml);
    await fs.writeFile(cleanedHtmlPath, cleanedHtml, "utf8");

    const { sections, keywords, images } = parseArticleSections(cleanedHtml);
    if (!sections || sections.length === 0) {
      throw new Error("No se encontraron secciones válidas en el HTML procesado.");
    }

    const jatsXml = generateJATSFromArticle(sections, keywords, images);
    await fs.writeFile(xmlPath, jatsXml, "utf8");

    // Limpiar imágenes no usadas
    const imageFiles = await fs.readdir(imagesFolder);
    if (imageFiles.length === 0) {
      await fs.remove(imagesFolder);
    }

    return { xmlPath, cleanedHtmlPath, imagesFolder };
  } catch (error) {
    throw new Error(`Error procesando artículo: ${error.message}`);
  }
};

  const cleanAndOptimizeHtml = (htmlContent) => {
    console.log("HTML original cargado:", htmlContent);
    const $ = cheerio.load(htmlContent);
    $("*").removeAttr("style");    
    $("br").remove(); // Elimina etiquetas <br>
    $("a").each((_, elem) => {
      $(elem).replaceWith($(elem).text());  // Reemplaza enlaces con texto plano
    });
    $("strong, em").each((_, elem) => {
      const $elem = $(elem);
      if ($elem.is("strong")) {
        $elem.replaceWith($("<bold>").html($elem.html()));  // Convierte <strong> a <bold>
      } else if ($elem.is("em")) {
        $elem.replaceWith($("<italic>").html($elem.html()));  // Convierte <em> a <italic>
      }
    });
    

    const cleanAndOptimizeHtml = (htmlContent) => {
      const $ = cheerio.load(htmlContent);
      $("*").removeAttr("style");  // Elimina los estilos no necesarios
      $("a, strong, em").each((_, elem) => {
        $(elem).replaceWith($(elem).text());  // Limpia enlaces, negritas y cursivas
      });
      $("img[src*='undefined']").remove();
      
      // Mantener estructura de tablas
      $("table").each((_, table) => {
        $(table).find("tr").each((_, row) => {
          $(row).find("td, th").each((_, cell) => {
            const content = $(cell).html().trim();
      
            // Eliminar etiquetas <p> que rodean el contenido dentro de las celdas
            const cleanContent = content.replace(/^<p>(.*?)<\/p>$/i, "$1").replace(/<\/p><p>/g, " ");
            $(cell).html(cleanContent);
          });
        });
      });
      
      $("p:has(table)").remove();  // Elimina cualquier párrafo que contenga una tabla completa
      return $.html();
    };
    
    $("p, div, span").each((_, elem) => {
      let content = $(elem).html().trim();
      content = content
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ");  // Espacios únicos
      if (content === "" && $(elem).find("img").length === 0) {
        $(elem).remove();
      } else {
        $(elem).html(content);
      }
    });
    return $.html();
  };


const parseArticleSections = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  const sections = [];
  const keywords = [];
  const images = [];
  const processedSections = new Set();  // Set para rastrear secciones procesadas
  const authorsSection = { title: "Autores", content: [] }; // Nueva sección

// Extraer párrafos de autores y afiliaciones
$("p.authors").each((_, elem) => {
  authorsSection.content.push({ type: "title", text: $(elem).text().trim() });
});
$("p.affiliations").each((_, elem) => {
  const text = $(elem).text().trim();
  if (text) {
    authorsSection.content.push({ type: "affiliation", text }); // Guardar cada párrafo completo
  }
});

// Extraer y manejar contenido de Boxed Text con bloques específicos
$("p.boxedtext").each((_, elem) => {
  let content = $(elem).html().trim();

  // Dividir contenido en cuatro bloques principales basados en patrones de texto
  const blocks = [];
  let match = content.match(/^(.*?Accepted:.*?)(Engineering and Applied Sciences.*?)?(How to cite this article:.*?)?(Articles in journal repositories.*)$/s);

  if (match) {
    // Separar líneas dentro del primer bloque
    const firstBlock = match[1].replace(/(DOI:|ISSN-e:|Submitted:|Revised:|Accepted:)/g, "\n$1").split("\n").filter(line => line.trim() !== "");
    blocks.push(firstBlock);  // Primer bloque como array de líneas

    // Separar líneas dentro del segundo bloque
    if (match[2]) {
      const secondBlock = match[2]
        .replace(/(<bold>\s*<\/bold>)/g, " ")  // Elimina etiquetas vacías de bold
        .replace(/(University of Guayaquil\..*?Ecuador)/, "\n$1")
        .replace(/(Frequency\/Year: \d+)/, "\n$1")
        .replace(/(Web:)/, "\n$1")
        .replace(/(revistas\.ug\.edu\.ec\/index\.php\/easi)/, "\n$1")
        .replace(/(Email:)/, "\n$1")
        .replace(/(easi-publication\.industrial@ug\.edu\.ec)/, "\n$1")
        .split("\n")
        .filter(line => line.trim() !== "");
      blocks.push(secondBlock);  // Segundo bloque como array de líneas
    }

    if (match[3]) blocks.push([match[3].trim()]);  // Tercer bloque como array
    if (match[4]) blocks.push([match[4].trim()]);  // Cuarto bloque como array
  }

  // Almacenar cada bloque como una sección separada
  blocks.forEach((block) => {
    sections.push({ title: "Boxed Text", content: Array.isArray(block) ? block : [block] });
  });
});

if (authorsSection.content.length > 0) {
  sections.push(authorsSection); // Agregar nueva sección a la lista
  processedSections.add("Autores");
}

  // Extraer títulos dinámicos
  const articleTitle = $("h1").first().text().trim();
  if (articleTitle) {
    sections.push({ title: "Título del artículo", content: articleTitle });
    processedSections.add("Título del artículo");
  }

  let secondaryTitle = $("h2").first().text().trim();
  if (!secondaryTitle && articleTitle) {
    secondaryTitle = articleTitle;  // Reutilizar h1 como título secundario
  }
  sections.push({
    title: "Título secundario",
    content: secondaryTitle || "",  // Dejar contenido vacío si no hay título
  });
  processedSections.add("Título secundario");

// Extraer imágenes
$("img").each((index, elem) => {
  const src = $(elem).attr("src");
  const alt = $(elem).attr("alt") || `Figura ${index + 1}`;
  images.push({ id: `fig-${index + 1}`, src, alt });
});

let tableCounter = 0;  // Contador global para las tablas

$("table").each((index, table) => {
  const tableData = [];
  $(table).find("tr").each((_, row) => {
    const rowData = [];
    $(row).find("td, th").each((_, cell) => {
      rowData.push($(cell).text().trim());
    });
    if (rowData.length > 0) {
      tableData.push(rowData);
    }
  });

  tableCounter++;  // Incrementa el contador al procesar una tabla
  sections.push({
    title: "Tabla",
    content: tableData,
    id: `table-${tableCounter}`  // Usa el contador para mantener consistencia
  });
});

  // Procesar párrafos
  $("p").each((_, elem) => {
    let content = $(elem).html().trim();
    // Ignorar párrafos que contienen tablas o contenido codificado como tablas
    if ($(elem).find("table").length > 0 || /&lt;table/.test(content)) {
      $(elem).remove();  // Elimina el párrafo completo
      return;
    }
  
  // Añadir referencias cruzadas a las imágenes
  images.forEach((image, index) => {
    const figurePattern = new RegExp(`\\b(Figura|Figure)\\s*${index + 1}\\b`, "g");
    content = content.replace(
      figurePattern,
      `<xref ref-type="fig" rid="fig-${index + 1}">$1 ${index + 1}</xref>`
    );
  });

  // Añadir referencias cruzadas a las tablas
  sections.filter(section => section.title === "Tabla").forEach((table) => {
    const tablePattern = new RegExp(`\\b(Tabla|Table)\\s*${table.id.replace('table-', '')}\\b`, "g");
    content = content.replace(
      tablePattern,
      `<xref ref-type="table" rid="${table.id}">$1 ${table.id.replace('table-', '')}</xref>`
    );
  });  

  $(elem).html(content);  // Actualiza el contenido con referencias cruzadas
});

// Extraer secciones por encabezados <h3>
$("h3").each((_, elem) => {
  const sectionTitle = $(elem).text().trim();
  if (!processedSections.has(sectionTitle)) {
    const sectionContent = [];
    const subsections = [];
    let nextElement = $(elem).next();
    
    while (nextElement.length > 0 && !["H3"].includes(nextElement.prop("tagName"))) {
      const tagName = nextElement.prop("tagName");

      if (tagName === "H4") {  // Procesar Título 4
        const title4 = nextElement.text().trim();
        const title4Content = [];
        nextElement = nextElement.next();
        while (nextElement.length > 0 && !["H3", "H4", "H5"].includes(nextElement.prop("tagName"))) {
          title4Content.push(nextElement.html().trim());
          nextElement = nextElement.next();
        }
        if (title4) {
          subsections.push({
            title: title4,
            content: title4Content,
            isTitle5: false  // Indicar que es un título de nivel 4
          });
        }
      } else if (tagName === "H5") {  // Procesar Título 5
        const title5 = nextElement.text().trim();
        const title5Content = [];
        nextElement = nextElement.next();
        while (nextElement.length > 0 && !["H3", "H4", "H5"].includes(nextElement.prop("tagName"))) {
          title5Content.push(nextElement.html().trim());
          nextElement = nextElement.next();
        }
        if (title5) {
          subsections.push({
            title: title5,
            content: title5Content,
            isTitle5: true  // Indicar que es un título de nivel 5
          });
        }
      } else if (tagName === "UL" || tagName === "OL") {
        const listItems = [];
        nextElement.find("li").each((_, liElem) => {
          listItems.push({ type: "list-item", text: $(liElem).text().trim() });
        });
        sectionContent.push({
          type: "list",
          listType: tagName === "UL" ? "bullet" : "ordered",
          items: listItems
        });
        nextElement = nextElement.next();  // Avanzar al siguiente elemento después de procesar la lista
      } else {
        sectionContent.push(nextElement.html().trim());
        nextElement = nextElement.next();
      }
    }      

    if (sectionContent.length > 0 || subsections.length > 0) {
      sections.push({ title: sectionTitle, content: sectionContent, subsections });
      processedSections.add(sectionTitle);
    }
  }
});

  // Mapear solo palabras clave manejadas como texto normal
  const sectionKeywords = {
    Abstract: ["Abstract"],
    Resumen: ["Resumen"],
    Keywords: ["Keywords"],
    "Palabras claves": ["Palabras claves"],
  };

  const findSectionByKeyword = (keywordsArray) => {
    for (const keyword of keywordsArray) {
      const sectionElement = $(`p:contains('${keyword}')`).first();
      if (sectionElement.length > 0) {
        return sectionElement.text().trim();
      }
    }
    return null;
  };

  for (const [title, keywordsArray] of Object.entries(sectionKeywords)) {
    if (!processedSections.has(title)) {
      const sectionContent = findSectionByKeyword(keywordsArray);
      if (sectionContent) {
        sections.push({ title, content: sectionContent });
        processedSections.add(title);
      }
    }
  }

  return { sections, keywords, images };
};



// Función para generar XML JATS
const generateJATSFromArticle = (sections, keywords, images) => {
  const xml = xmlbuilder
  .create("article", { version: "1.0", encoding: "UTF-8" })
  .att("xmlns:xlink", "http://www.w3.org/TR/REC-html40")
  .att("article-type", "research")
  .att("dtd-version", "1.3")
  .att("specific-use", "production")
  .att("xml:lang", "en");

console.log("All section titles:", sections.map(sec => sec.title));

 // Hardcodear journal-meta
 const front = xml.ele("front");
 const journalMeta = front.ele("journal-meta");
 journalMeta.ele("journal-id", { "journal-id-type": "publisher" }, "EASI: Ingeniería y Ciencias Aplicadas en la Industria");
 journalMeta.ele("issn", "2953-6634");
 const journalTitleGroup = journalMeta.ele("journal-title-group");
 journalTitleGroup.ele("journal-title", "EASI: Ingeniería y Ciencias Aplicadas en la Industria");
 const publisher = journalMeta.ele("publisher");
 publisher.ele("publisher-name", "Universidad de Guayaquil");
 publisher.ele("publisher-loc", "Guayaquil, Ecuador");

// Hardcodear article-categories
const articleMeta = front.ele("article-meta");
const articleCategories = articleMeta.ele("article-categories");
const subjGroup = articleCategories.ele("subj-group");
subjGroup.ele("subject", " ");
subjGroup.ele("subject", " ");
subjGroup.ele("subject", " ");

// Añadir Title-Group, Volume e Issue
const titleGroup = articleMeta.ele("title-group");

// Título dinámico del artículo (extraído de las secciones)
const articleTitle = sections.find((sec) => sec.title === "Título del artículo");
if (articleTitle) {
  titleGroup.ele("article-title", articleTitle.content);
}

// Hardcodear <volume> y <issue>
articleMeta.ele("volume", " ");
articleMeta.ele("issue", " "); 

// Hardcodear permisos
const permissions = articleMeta.ele("permissions");
permissions.ele("copyright-statement", "© ");
permissions.ele("copyright-year", " ");
permissions.ele("copyright-holder", " ");
const license = permissions.ele("license", { "xlink:href": "https://creativecommons.org/licenses/by/4.0/" });
const licenseP = license.ele("license-p");
// Añade texto con un enlace interno (<ext-link>)
licenseP.txt("This article is distributed under the terms of the ");
licenseP.ele("ext-link", {
  "ext-link-type": "uri",
  "xlink:href": "http://creativecommons.org/licenses/by/4.0/"
}).txt("Creative Commons Attribution License");
licenseP.txt(", which permits unrestricted use and redistribution provided that the original author and source are credited.");

// Hardcodear abstract y boxed-texts
const abstract = articleMeta.ele("abstract", { "abstract-type": "section" });

// Título dinámico dentro de <abstract>
const secondaryTitle = sections.find((sec) => sec.title === "Título secundario");
if (secondaryTitle) {
  abstract.ele("title", secondaryTitle.content);  // Inserta el contenido del titulo secundario
}

// Añadir sección dinámica para autores y afiliaciones
const authorsSection = sections.find((sec) => sec.title === "Autores");
if (authorsSection) {
  const authorsSec = abstract.ele("sec");
  let authorsText = '';
  let affiliationsText = '';
  let correspondingAuthorText = '';

  authorsSection.content.forEach((item) => {
    if (item.type === "title") {
      authorsText = item.text;  // Título de autores
    } else if (item.type === "affiliation") {
      const affParts = item.text.split(/(\(\w\)|corresponding\s*author:|autor\s*de\s*correspondencia:)/i).filter(Boolean); // Detectar superíndices y ambas frases
      let currentAffiliation = '';
  
      affParts.forEach((part, index) => {
        console.log(`Affiliation part ${index}: "${part}"`);
        if (/^\(\w\)$/.test(part)) {
          if (currentAffiliation.trim()) {
            affiliationsText += `<p>${currentAffiliation.trim()}</p>`;
            currentAffiliation = '';
          }
          currentAffiliation = `<sup>${part}</sup> `;
        } else if (/corresponding\s*author:|autor\s*de\s*correspondencia:/i.test(part)) {
          if (currentAffiliation.trim()) {
            affiliationsText += `<p>${currentAffiliation.trim()}</p>`;
          }
          currentAffiliation = part.trim() + ' ';  // Inicia nuevo párrafo con la frase detectada
        } else {
          currentAffiliation += part;
        }
      });
  
      if (currentAffiliation.trim()) {
        affiliationsText += `<p>${currentAffiliation.trim()}</p>`;
      }
    }
  });
  
  // Agregar resultado final
  authorsSec.ele("title", authorsText);
  authorsSec.raw(affiliationsText.trim());
  
}

// Agregar múltiples boxed-text dinámicos correctamente
const boxedTextSections = sections.filter((sec) => sec.title === "Boxed Text");
if (boxedTextSections.length > 0) {
  boxedTextSections.forEach((boxedTextSection) => {
    const dynamicBoxedText = abstract.ele("sec").ele("boxed-text"); // Crear una sola sección de boxed-text
    if (Array.isArray(boxedTextSection.content)) {
      boxedTextSection.content.forEach((line) => {
        console.log("Contenido de la línea del Boxed Text:", line); // Depuración
        dynamicBoxedText.ele("p").txt(decode(line.trim())); // Agregar cada línea como un párrafo separado dentro del mismo boxed-text
      });
    }
  });
}

// Procesar abstract dinámico
const abstractSection = sections.find((sec) => sec.title === "Abstract");
if (abstractSection) {
  const abstractText = abstractSection.content;
  const [abstractTitle, ...abstractBody] = abstractText.split(". "); // Separar el título y el cuerpo
  const abstractDynamicSec = abstract.ele("sec"); // Crear sección para contenido dinámico
  abstractDynamicSec.ele("title", abstractTitle); // Agregar título dinámico
  abstractDynamicSec.ele("p", abstractBody.join(". ")); // Agregar cuerpo restante
}

const keywordsSection = sections.find((sec) => sec.title === "Keywords");
if (keywordsSection) {
  const keywordsText = keywordsSection.content.trim();
  const [keywordsTitle, ...keywordsList] = keywordsText.split(": ");
  const keywordsDynamicSec = abstract.ele("sec");
  keywordsDynamicSec.ele("title", `${keywordsTitle}:`);
  keywordsList.forEach((keyword) => {
    keywordsDynamicSec.ele("p", keyword.trim());  // Inserta cada palabra clave como párrafo
  });
}

const resumenSection = sections.find((sec) => sec.title === "Resumen");
if (resumenSection) {
  const resumenText = resumenSection.content.trim();
  const [resumenTitle, ...resumenBody] = resumenText.split(". ");
  const resumenDynamicSec = abstract.ele("sec");
  resumenDynamicSec.ele("title", resumenTitle);
  resumenDynamicSec.ele("p", resumenBody.join(". "));
}

const palabrasClavesSection = sections.find((sec) => sec.title === "Palabras claves");
if (palabrasClavesSection) {
  const palabrasClavesText = palabrasClavesSection.content.trim();
  const [palabrasClavesTitle, ...palabrasClavesList] = palabrasClavesText.split(": ");
  const palabrasClavesDynamicSec = abstract.ele("sec");
  palabrasClavesDynamicSec.ele("title", `${palabrasClavesTitle}:`);
  palabrasClavesList.forEach((clave) => {
    palabrasClavesDynamicSec.ele("p", clave.trim());
  });
}

// Hardcodear kwd-group (vacías explícitamente)
const kwdGroup = articleMeta.ele("kwd-group", { "kwd-group-type": "author-keywords" });
kwdGroup.ele("title", "Keywords");
kwdGroup.ele("kwd").text(" "); // Etiqueta explícita con contenido vacío
kwdGroup.ele("kwd").text(" ");
kwdGroup.ele("kwd").text(" "); 


// Lista de títulos de secciones a excluir del cuerpo del artículo
const excludedSections = [
  "Título del artículo",
  "Título secundario",
  "Abstract",
  "Resumen",
  "Keywords",
  "Palabras claves",
  "Autores",
  "Afiliaciones",
  "Boxed Text",
];

// Cuerpo del artículo
const body = xml.ele("body");

sections.forEach((section, index) => {
  if (!excludedSections.includes(section.title)) {
    const sec = body.ele("sec"); // Sección principal
    sec.ele("title", section.title);

    if (section.title === "Tabla") {
      const tableWrap = sec.ele("table-wrap", { id: section.id });  // Usa el mismo id
      tableWrap.ele("label", `Table ${section.id.replace('table-', '')}`);
      const caption = tableWrap.ele("caption");
      caption.ele("title", `Table ${section.id.replace('table-', '')}`);
      const table = tableWrap.ele("table");
    
      section.content.forEach((row, rowIndex) => {
        const tableRow = table.ele("tr");
        row.forEach((cell) => {
          const cellTag = rowIndex === 0 ? "th" : "td";
          tableRow.ele(cellTag, cell);
        });
      });
    } else {
      if (section.content) {
        section.content.forEach(paragraph => {
          const decodedParagraph = decode(paragraph);  // Decodificación de entidades HTML

          if (/^<table|&lt;table|<tbody|&lt;tbody|<img|&lt;img/.test(decodedParagraph)) {
            return;  // Omitir contenido de tablas o imágenes
          }

          // Manejar listas
          if (/<li>/.test(decodedParagraph)) {
            const list = sec.ele("list", { "list-type": "bullet" });
            const listItems = decodedParagraph.match(/<li>(.*?)<\/li>/g) || [];
            listItems.forEach(item => {
              const content = item.replace(/<\/?li>/g, '').trim();
              const listItem = list.ele("list-item");
              listItem.ele("p", content);
            });
          } else {
            sec.ele("p").txt(decodedParagraph);  // Agregar párrafos normales
          }
        });
      }

      section.subsections?.forEach(subsection => {
        if (!excludedSections.includes(subsection.title)) {
          if (subsection.isTitle5) {
            sec.ele("p").ele("italic").ele("bold", subsection.title);
            subsection.content.forEach(paragraph => {
              const decodedSubParagraph = decode(paragraph);

              if (/^<table|&lt;table|<tbody|&lt;tbody|<img|&lt;img/.test(decodedSubParagraph)) {
                return;
              }

              if (/<li>/.test(decodedSubParagraph)) {
                const list = sec.ele("list", { "list-type": "bullet" });
                const listItems = decodedSubParagraph.match(/<li>(.*?)<\/li>/g) || [];
                listItems.forEach(item => {
                  const content = item.replace(/<\/?li>/g, '').trim();
                  const listItem = list.ele("list-item");
                  listItem.ele("p", content);
                });
              } else {
                sec.ele("p").txt(decodedSubParagraph);
              }
            });
          } else {
            const subsec = sec.ele("sec");
            subsec.ele("title", subsection.title);
            subsection.content.forEach(paragraph => {
              const decodedSubParagraph = decode(paragraph);

              if (/^<table|&lt;table|<tbody|&lt;tbody|<img|&lt;img/.test(decodedSubParagraph)) {
                return;
              }

              if (/<li>/.test(decodedSubParagraph)) {
                const list = subsec.ele("list", { "list-type": "bullet" });
                const listItems = decodedSubParagraph.match(/<li>(.*?)<\/li>/g) || [];
                listItems.forEach(item => {
                  const content = item.replace(/<\/?li>/g, '').trim();
                  const listItem = list.ele("list-item");
                  listItem.ele("p", content);
                });
              } else {
                subsec.ele("p").txt(decodedSubParagraph);
              }
            });
          }
        }
      });
    }
  }
});



// Agregar imágenes con formato específico
images.forEach((image, index) => {
  const fig = body.ele("fig", { id: `fig-${index + 1}` }); 
  fig.ele("graphic", {
    mimetype: "image",
    "mime-subtype": "png",  // Ajusta según el tipo de imagen si es necesario
    "xlink:href": `media/image${String(index + 1).padStart(3, '0')}.png`  // Usa un formato numerado para el nombre del archivo
  });
  
  const caption = fig.ele("caption");
  caption.ele("label").txt(`Figure ${index + 1}.`);  // Etiqueta
  caption.ele("title").txt(`Figure ${index + 1}.`);  // Formato del título con punto al final
});

// Sección <back>
const back = xml.ele("back");

// Genera el XML como string
let xmlString = xml.end({ pretty: true });

// Reemplazar entidades codificadas después de la generación
xmlString = xmlString.replace(/&lt;/g, "<").replace(/&gt;/g, ">");

return xmlString;  // Retornar el string XML desde la función.

};