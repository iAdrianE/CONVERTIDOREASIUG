//document.getElementsByTagName("button")[0].addEventListener("click",()=>{
//    document.cookie ='jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
//    document.location.href = "/"
//  })
document.addEventListener("DOMContentLoaded", () => {
    // Referencias a los elementos del formulario.
    const form = document.getElementById("upload-form");
    const fileInput = document.getElementById("file-upload");
    const outputContainer = document.getElementById("output-container");
    const downloadLink = document.getElementById("download-link");
    const imagesDownloadLink = document.getElementById("download-images-link");
    const downloadHtmlLink = document.getElementById("download-html-link");
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // Tamaño máximo permitido: 10 MB

    // Desactivar los botones de descarga al cargar la página
    downloadLink.disabled = true;
    imagesDownloadLink.disabled = true;
    downloadHtmlLink.disabled = true;

    // Función para desactivar un botón de descarga.
    function disableButton(button) {
        button.disabled = true;
    }

    // Evento para manejar el envío del formulario.
    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!fileInput.files.length) {
            alert("Por favor, selecciona un archivo Word.");
            return;
        }

        const file = fileInput.files[0];

        // Validar tipo de archivo
        if (file.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            alert("Solo se permiten archivos .docx.");
            return;
        }

        // Validar tamaño de archivo
        if (file.size > MAX_FILE_SIZE) {
            alert("El archivo es demasiado grande. El tamaño máximo permitido es 10 MB.");
            return;
        }

        const templateType = document.getElementById("template-type").value; // Obtener el tipo de documento seleccionado

        const formData = new FormData();
        formData.append("file", file);
        formData.append("template", templateType); // Enviar el tipo de documento

        // Desactivar todos los botones de descarga mientras se procesa el archivo.
        disableButton(downloadLink);
        disableButton(imagesDownloadLink);
        disableButton(downloadHtmlLink);

        try {
            const response = await fetch("/api/convertir", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error("Error al procesar el archivo.");
            }

            const result = await response.json();

            // Configurar enlaces de descarga con nombres de archivo correctos
            downloadLink.dataset.href = result.xmlDownloadUrl;
            downloadLink.dataset.filename = file.name.replace(".docx", ".xml");
            imagesDownloadLink.dataset.href = result.imagesDownloadUrl;
            imagesDownloadLink.dataset.filename = file.name.replace(".docx", ".zip");
            downloadHtmlLink.dataset.href = result.cleanedHtmlDownloadUrl;
            downloadHtmlLink.dataset.filename = file.name.replace(".docx", ".html");

            outputContainer.classList.remove("hidden");

            // Activar los botones de descarga solo después de que el archivo haya sido procesado exitosamente
            downloadLink.disabled = false;
            imagesDownloadLink.disabled = false;
            downloadHtmlLink.disabled = false;

            alert("Archivo procesado exitosamente.");
        } catch (error) {
            alert(`Error al procesar el archivo: ${error.message}`);
            console.error("Detalles del error:", error);
        }
    });

    // Funciones para desactivar cada botón después de usarlo.
    downloadLink.addEventListener("click", () => {
        disableButton(downloadLink);
    });

    imagesDownloadLink.addEventListener("click", () => {
        disableButton(imagesDownloadLink);
    });

    downloadHtmlLink.addEventListener("click", () => {
        disableButton(downloadHtmlLink);
    });
});
