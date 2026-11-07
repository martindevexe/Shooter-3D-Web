**Línea de Fuego** es un videojuego táctico de disparos en primera persona (FPS 3D) ejecutable de forma nativa en el navegador, enfocado en la limpieza de sectores urbanos y la supervivencia contra oleadas enemigas.

**Arquitectura Técnica y Motor**

* **Renderizado 3D:** Desarrollado con **HTML5 Canvas** y **WebGL**, procesando gráficos tridimensionales en tiempo real directamente en el cliente web sin requerir complementos externos.
* **Control del Jugador:** Implementa la **Pointer Lock API** para capturar el puntero del ratón y permitir la rotación de cámara en 360° con inclinación (*pitch/yaw*). Captura eventos de teclado para desplazamiento omnidireccional (*WASD*), esprintar y cambiar de estado.
* **Sistemas Internos:** Integra detección de colisiones contra la geometría del entorno, raycasting para el cálculo de disparos y recolección de objetos, así como inteligencia artificial básica para el comportamiento y rastreo de los terroristas.

**Mecánicas de Juego y Combate**

* **Gestión de Recursos:** Mantiene tres barras de estado dinámicas: **Salud**, **Chaleco** (mitigación de daño) y **Energía** (consumida progresivamente al correr con `Shift`).
* **Inventario y Armamento:** Cuenta con dos espacios para armas de fuego intercambiables (`1` / `2`), recarga manual (`R`), apuntado con mira/ADS (`Clic Derecho`), inspección visual de arma (`Y`) y combate cuerpo a cuerpo con cuchillo estilo Karambit (`3`).
* **Sistema de Interacción:** Botiquines, munición y potenciadores se recogen automáticamente al pasar cerca; las armas del suelo se recogen manualmente con `Tecla F`.

**Estructura y Flujo de Juego**

* **Progresión por Sectores:** El juego se organiza en 4 zonas de dificultad ascendente (iniciando en la *Zona 1: Muelle de Carga*).
* **Condición de Victoria:** El jugador debe eliminar a la totalidad de los terroristas del sector activo. Al despejar el área, aparece un ascensor de extracción: al subirse, el jugador desciende por un pozo, ve un resumen de la zona (abatidos, tiempo, precisión) y llega al siguiente nivel bajando desde el techo, hasta alcanzar el enfrentamiento final contra un jefe con barra de vida propia.
* **Interfaz de Usuario (HUD):** Incluye minimapa en tiempo real, contador de enemigos restantes, puntuación acumulada, barra de jefe y menús interactivos de pausa, misión fallida y victoria.
DESPLEGADO: https://shooter-web-jet.vercel.app/
