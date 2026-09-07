# Prueba de Concepto WebAR - Comparativa de Motores

Este proyecto compara cuatro motores de Realidad Aumentada Web (WebAR) utilizando Image Tracking (seguimiento de imágenes) para proyectar dos modelos 3D obtenidos del repositorio oficial de Khronos glTF Sample Models:
- **human.png** -> Modelo CesiumMan (`CesiumMan.glb`)
- **fox.png** -> Modelo Fox (`Fox.glb`)

---

## Motores Implementados

### 1. MindAR (`mindar.html`)
- **Funcionamiento**: Utiliza un archivo compilado (`targets.mind`) que contiene los descriptores de ambas imágenes.
- **Targets soportados**: Múltiples simultáneamente (Target 0 = CesiumMan, Target 1 = Fox).
- **Archivos requeridos**: `targets.mind`.

### 2. Simple-AR (`simple-ar.html`)
- **Repositorio**: [akbartus/Simple-AR](https://github.com/akbartus/Simple-AR)
- **Funcionamiento**: Motor WebAssembly que permite cargar directamente imágenes `.png` o `.jpg` en tiempo de ejecución sin compilación previa.
- **Particularidad**: Por diseño interno de su motor WASM, **solo admite 1 target activo a la vez**.
- **Solución implementada**: Se incluye un selector dinámico en la interfaz (`?target=human` y `?target=fox`) para alternar fácilmente entre `human.png` y `fox.png`.
- **Archivos requeridos**: `human.png` y `fox.png`.

### 3. AR.js NFT (`arjs.html`)
- **Funcionamiento**: Utiliza Natural Feature Tracking (NFT) con ARToolKit y A-Frame.
- **Particularidad**: **No puede leer imágenes PNG directamente**. Requiere descriptores generados previamente (`.fset`, `.fset3`, `.iset`).
- **Archivos generados**:
  - `nft/human.fset`, `nft/human.fset3`, `nft/human.iset`
  - `nft/fox.fset`, `nft/fox.fset3`, `nft/fox.iset`
- **Targets soportados**: Soporta detección de ambos marcadores en la escena.

### 4. WebXR Nativo (`webxr.html`)
- **Funcionamiento**: Utiliza la API nativa W3C WebXR Device API con la especificación `image-tracking` (`trackedImages` y `frame.getImageTrackingResults()`) integrada directamente en A-Frame sin dependencias de terceros.
- **Requisitos de hardware/software**: Requiere dispositivo Android con ARCore y Google Chrome (habilitando la flag `chrome://flags#webxr-incubations`).
- **Fallback incluido**: Si se abre en PC o navegadores sin WebXR AR inmersivo, muestra un panel informativo y una vista previa 3D de los modelos para inspección.

---

## Cómo Ejecutar

Para acceder a la cámara y a las APIs de WebXR/WebAR en navegadores móviles, es obligatorio servir los archivos bajo **HTTPS** o `localhost`:

```bash
# Ejemplo con servidor HTTP local:
npx serve -l 3000
```
