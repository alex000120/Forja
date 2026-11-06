# Forja · v1.2

**Agente autónomo para crear y mantener páginas y apps web.** Le das un objetivo; Forja planifica, escribe los archivos, los prueba en un navegador oculto y corrige lo que falla. Sitios estáticos sin build, listos para GitHub Pages o Vercel.

## Cómo usarlo
1. Servilo desde un servidor estático (usa módulos ES, no abre bien con `file://`): `python3 -m http.server` y entrá a `http://localhost:8000/forja/`. También funciona publicado en GitHub Pages.
2. En **Ajustes** elegí proveedor, modelo y clave de API.
3. Creá un proyecto (o importá un ZIP) y escribí el objetivo. Podés activar hasta 5 guías por pedido.

## Estructura
```
index.html          interfaz (proyectos · chat · vista previa)
css/styles.css
js/main.js          arranque y eventos
js/agent.js         bucle del agente (reintentos, cambio de modelo, auto-verificación)
js/tools.js         herramientas del agente
js/instructions.js  el «cerebro»: instrucciones base + guías (playbooks)
js/preview.js       vista previa, inspección y pruebas de interacción
js/verify.js       verificación manual y automática (local, sin créditos de IA)
js/ai.js · state.js · ui.js · export.js · importer.js · version.js
```

## Herramientas del agente (27) y guías (155)
| Grupo | Herramientas |
|---|---|
| Archivos | `list_files` `read_file` `read_files` `write_file` `append_file` `edit_file` `multi_edit` `delete_file` `rename_file` `copy_file` |
| Entender el código | `outline_file` `search_files` |
| Verificar | `check_project` `inspect_page` `interact_page` |
| Recursos externos | `lookup_library` `fetch_url` |
| Organización y memoria | `update_plan` `save_note` `use_playbook` |
| Autonomía (v1.2) | `write_files` `replace_in_files` `checkpoint` `diff_changes` `audit_page` `find_unused` `add_boilerplate` |

## Novedades de la versión 1.2
- `write_files`: hasta 8 archivos completos en una sola llamada (todo o nada).
- `replace_in_files`: buscar y reemplazar en todo el proyecto, con `dry_run` para simular.
- `checkpoint`: guardar, listar y restaurar puntos de control dentro de un pedido.
- `diff_changes`: resumen de lo cambiado y diferencias línea por línea de un archivo.
- `audit_page`: contraste real calculado, áreas táctiles, texto diminuto, campos sin etiqueta, imágenes sin tamaño, ids repetidos y peso del DOM.
- `find_unused`: archivos sin referenciar, clases CSS y funciones JS sin uso (heurística).
- `add_boilerplate`: favicon, manifest, service worker con precaché automático, robots, sitemap, 404, vercel.json y README.
- 100 guías nuevas (155 en total) en tres categorías: Negocios, Utilidades y Tecnología avanzada.

## Ajustes de la versión 1.1 (interfaz)
- **Botón «✔ Verificar»** y pestaña **Informe**: revisa estructura, código y la página real a 1280 y 390 px. Corre en tu navegador, **sin gastar créditos de IA**. El botón muestra el estado (✔ Todo OK · ⚠ n problemas).
- **Verificación automática** después de cada pedido en el que el agente cambió archivos.
- **«🛠 Pedir al agente que lo corrija»**: envía el informe como pedido (activa la guía de depuración). También se puede copiar.
- **Pruebas en vivo**: los resultados de `check_project`, `inspect_page` e `interact_page` aparecen desplegables en el chat, durante y después de la ejecución.
- **Plan con barra de progreso** (`3/5`).

## Ajustes de la versión 1.0
**Herramientas nuevas**
- `interact_page`: prueba la página como un usuario (click, escribir, esperar, leer texto, contar elementos, evaluar JS) y devuelve resultados y errores de consola.
- `outline_file`: mapa de un archivo (funciones, selectores, secciones) sin leerlo entero.
- `read_files`, `multi_edit`, `append_file`, `copy_file`: menos llamadas por tarea, edición atómica y archivos largos por partes.
- `lookup_library`: versión y URLs reales de CDN (jsDelivr) en vez de inventarlas.
- `fetch_url`: ve la respuesta real de una API antes de programar contra ella.
- `save_note`: memoria duradera en `PLAN.md`, que se reinyecta en cada pedido.

**Autonomía**
- Auto-verificación: si el agente modificó código y quiere cerrar sin haber corrido `check_project` o `inspect_page`, se lo exige una vez.
- Anti-bucle: si repite una llamada que ya falló, recibe el aviso de cambiar de enfoque.
- Nuevas reglas de método: economía de llamadas, no inventar recursos, probar lo interactivo, usar la memoria.

**Análisis estático (`check_project`)**
- Etiquetas HTML sin cerrar o sobrantes, ids que el JS busca y no existen, campos sin `<label>`, `target="_blank"` sin `rel`, enlaces `href="#"`, favicon, meta description y texto «lorem ipsum».

**Guías nuevas**: *App web (SPA)* (estado, rutas por hash, render) y *Pruebas de flujo* (genera `TESTS.md`).

**Otros**: versión visible en la interfaz (`js/version.js`) y README completo.
