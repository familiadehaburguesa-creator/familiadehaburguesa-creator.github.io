# Familia de Hamburguesa — app interna

Gestión diaria del negocio: ventas por turno, finanzas, producción y tablero.

**En vivo: https://familiadehaburguesa-creator.github.io/**

Se puede instalar en el celular como app (en el navegador: "Agregar a pantalla de inicio").

---

## Cómo está armado

No hay servidor propio ni base de datos. Son tres piezas:

| Pieza | Qué es | Dónde vive |
|---|---|---|
| **Front** | 6 páginas HTML sueltas, sin framework ni compilación | este repo, servido por GitHub Pages |
| **MENSAJERO** | un Google Apps Script que recibe y devuelve datos | script asociado al Cuaderno |
| **Cuaderno** | una planilla de Google Sheets — es la base de datos | Google Drive |

Los módulos:

- `index.html` / `home_familia_hamburguesa.html` — ingreso y menú
- `modulo_ventas.html` — apertura y cierre de turno, ventas, fiados, conteo de caja
- `modulo_finanzas.html` — gastos, tesorería, fondo de inversión, deudores, reporte por período
- `modulo_produccion.html` — producción de carnes, stock, cámara
- `modulo_tablero.html` — objetivos y acumulados (solo lectura)

---

## Reglas que hay que respetar sí o sí

**El MENSAJERO escribe por posición, no por nombre de columna.** Una columna nueva va **siempre al final** de su hoja, en el script y en la planilla. Si se mete en el medio, todos los datos viejos se corren de lugar y quedan mal.

**Guardar no es publicar.** El endpoint sirve la *versión publicada* del script. Después de editarlo: Implementar → Administrar las implementaciones → lápiz → Versión: **Nueva** → Implementar. Nunca "Nueva implementación": eso genera una URL distinta y hay que reconfigurar los 6 módulos.

**El front no recibe respuesta al escribir.** Manda con `mode:'no-cors'`, así que nunca se entera de si el dato entró. Toda la validación tiene que estar del lado del navegador, antes de mandar.

**El servidor recalcula `SaldoCliente`** en la hoja Deudas, pero solo cuando la fila entra por la app. Una fila pegada a mano en la planilla se muestra con el saldo que tenga escrito.

---

## Cómo publicar una versión nueva

1. Correr el gate: `python3 fdh_qa/validar.py ruta/al/sitio` — tiene que dar **220/220**. Sin gate verde no se sube.
2. Correr la auditoría responsive: `python3 fdh_qa/auditar_responsive.py ruta/al/sitio` — 0 desbordes en celular y escritorio.
3. En este repo: **Add file → Upload files**, arrastrar los archivos modificados, **Commit changes**.
4. GitHub Pages republica solo en 1-2 minutos.

Si se tocan los íconos, la carpeta `icons` se arrastra **como carpeta**. Si se arrastran los archivos sueltos quedan en la raíz y `/icons/*` da 404: se rompen el favicon y la instalación como app.

---

## Pendiente conocido

La URL del MENSAJERO está escrita dentro del HTML, que es público. Cualquiera que mire el código fuente puede mandarle datos al Cuaderno. Se resuelve con una clave compartida entre el front y el script.
