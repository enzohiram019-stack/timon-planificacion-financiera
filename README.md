# Timón · Planificación financiera

Herramienta web de planificación financiera. Funciona de dos maneras:

- **Con servidor y usuarios** (`server/server.js` + `public/index.html`): consultor y cliente entran con su correo y contraseña desde cualquier equipo y trabajan sobre los mismos datos. Es lo que publica el `render.yaml` de la raíz (servicio pago con disco persistente).
- **Sin servidor** (`public/index.html` solo): sitio estático gratis o archivo local; los datos quedan en el navegador de cada persona. Ver `render-estatico/render.yaml`.

## Qué incluye

| Sección | Para qué sirve |
|---|---|
| **Tablero** | Caja real y proyectada, saldo mínimo, ventas del mes contra presupuesto, cuentas por cobrar, resultado del año y alertas. |
| **Flujo de caja** | Flujo **semanal** con columnas de proyección y real por semana, cierre de semana y vista **mensual** con la misma estructura de la planilla original. Acepta fórmulas en las celdas (`=2500000/TC`). |
| **Ventas y cobranzas** | Registro de ventas (contado, crédito o cuotas) con IVA y moneda, cuentas por cobrar con antigüedad, cobros y cambio de vencimientos. |
| **Compras y pagos** | Registro de compras a proveedores con destino (inventario, gasto o inversión), IVA, moneda y plazo; cuentas por pagar y pagos. Una compra puede descontar la proyección de su línea del flujo. |
| **Bancos** | Caja y cuentas bancarias en guaraníes o dólares con su saldo inicial, y conciliación semanal: saldo de cada banco contra el saldo real de la herramienta, con ajuste de la diferencia. |
| **Préstamos** | Cronograma por préstamo (francés, alemán o al vencimiento, con gracia): desembolso, cuotas de capital e intereses van solos al flujo, el EERR y el balance. |
| **Plan comercial** | Presupuesto de ventas por cliente y producto: cantidades por mes, precio y plazo de cobro. Avance contra lo vendido, clientes y productos con costo unitario. |
| **Producción y stock** | Receta de cada producto (toneladas de cada insumo por tonelada), stock de materia prima y de producto terminado en toneladas, compras planificadas para mantener el stock mínimo (van al flujo según el plazo del proveedor) y costo promedio de la materia prima, que es el costo de ventas del EERR. |
| **Presupuesto EERR** | Estado de resultados mensual en tres versiones (presupuesto, real y proyección) y comparativo con variaciones. El presupuesto se puede aprobar (queda fijo). |
| **Balance proyectado** | Balance al cierre de cada mes con control de cuadre e indicadores (liquidez, prueba ácida, endeudamiento, capital de trabajo). |
| **Indicadores** | Cobertura de caja en semanas, días de cobro y de pago (general y por cliente o proveedor), días de inventario, punto de equilibrio y margen de contribución; precisión de la proyección: fotos mensuales automáticas comparadas contra lo que pasó. |
| **Escenarios** | Base, optimista y pesimista: ajustan volumen y precio de lo que falta vender y los días de cobro. Compara caja y resultado y permite elegir el escenario en uso. |
| **Configuración** | Empresa, moneda y tipo de cambio, período, supuestos, estructura del flujo (grupos, líneas y su tipo) y respaldos. |

## Cómo se conecta todo

Registrar una venta:

1. Agenda su cobro en el flujo (grupo **Deudas a cobrar**) en la semana de cada vencimiento.
2. Suma a **Ventas netas** del EERR en el mes de la venta y calcula su costo (costo unitario del producto o el porcentaje general).
3. Descuenta lo pendiente del **plan comercial** de ese cliente y mes, así no se cuenta dos veces en **Ventas proyectadas**.
4. Mientras no se cobra, figura en **Cuentas por cobrar** del balance.

Registrar el cobro pasa ese monto de proyectado a real en la semana del cobro.

Otras conexiones:

- **Gastos variables** (comisiones, fletes): en Configuración → Estructura del flujo se indica el % de las ventas y si se paga a fin del mismo mes o del siguiente. La proyección sale sola de las ventas (registradas + plan, según el escenario).
- **Descuento de documentos y cheques diferidos**: desde cuentas por cobrar, «Descontar». Entra a caja el neto (monto − intereses − gastos) en la semana del descuento, el documento queda cobrado y el costo va a gastos financieros. El formulario muestra si con eso la semana con saldo negativo deja de serlo; el tablero avisa cuando hay documentos para descontar.
- **Compras de materia prima**: al registrar una compra se puede indicar el insumo y las toneladas; suma al stock y descuenta lo planificado.

Las compras funcionan igual del lado de los pagos. El IVA de ventas (débito) y de compras (crédito) se liquida por mes y se proyecta como pago el día configurado del mes siguiente. Ventas, compras y préstamos pueden estar en US$ o en guaraníes con su tipo de cambio; si un cobro o pago se hace a otro tipo de cambio, la diferencia va al EERR como diferencia de cambio.

## Plantilla Excel

En **Configuración → Datos y respaldos**:

- **Plantilla vacía** o **Plantilla con los datos actuales**: Excel con las hojas Configuración, Clientes, Productos, Proveedores, Plan comercial, Flujo de caja (semanal; también acepta columnas mensuales), Gastos variables, Saldos iniciales, Préstamos, Balance inicial, Cuentas, Insumos y Recetas, más un **Presupuesto EERR** que se calcula con fórmulas.
- **Importar Excel** reconoce la plantilla y ofrece dos modos: **Actualizar plan y proyecciones** (mantiene ventas, compras, cobros, pagos, reales y cierres) o **Reemplazar todo**.

## Publicar en Render con usuarios (datos en la nube)

1. Crear un repositorio **privado** en GitHub con esta carpeta (`public/`, `server/`, `package.json`, `render.yaml`, `README.md`). El `.gitignore` evita subir `datos/` y `data/`.
2. En Render: **New → Blueprint**, elegir el repositorio. Render lee `render.yaml` y crea un servicio web Node (plan **Starter**) con un **disco persistente** de 1 GB montado en `/var/data`.
3. Render pide dos valores: `ADMIN_EMAIL` y `ADMIN_PASSWORD` (8 caracteres o más). Con eso se crea el primer administrador al arrancar.
4. Entrar a la dirección del servicio (`https://….onrender.com`) con ese usuario, crear la empresa (en blanco, con datos de ejemplo, o importando la planilla después) y, en el menú del usuario → **Usuarios y empresas**, crear los usuarios:
   - **Administrador**: ve y edita todas las empresas y gestiona usuarios (por ejemplo, el consultor).
   - **Puede editar**: carga ventas, cobros, compras, flujo, etc. en las empresas asignadas.
   - **Solo lectura**: consulta reportes (por ejemplo, un socio o el gerente del cliente).
5. Cada cambio que se suba al repositorio se vuelve a publicar solo; los datos del disco no se tocan.

Costos (aproximados; confirmar en render.com/pricing antes de contratar): el servicio Starter ronda los **US$ 7 por mes** y el disco persistente unos **US$ 0,25 por GB por mes** (1 GB alcanza para muchas empresas). El plan gratuito de servicios web no admite disco persistente y se apaga sin uso, por eso no sirve para guardar datos.

Cómo funciona:

- Los datos de cada empresa se guardan en `/var/data/empresas/` (un archivo JSON por empresa) y los usuarios en `/var/data/db.json`. Contraseñas con scrypt; sesiones con cookie `HttpOnly` de 30 días.
- Se guarda solo, un instante después de cada cambio. Si dos personas editan a la vez, la segunda recibe un aviso y se le carga la versión más nueva (no se pisan datos). Cada 45 segundos la pantalla trae los cambios de los demás.
- **Respaldos**:
  - **Respaldo de una empresa** (cualquier usuario con acceso): menú del usuario → botón «Respaldo» junto a cada empresa, o Datos y respaldos → «Respaldo de esta empresa». Lleva solo los datos de esa empresa, sin usuarios; se vuelve a cargar con «Restaurar respaldo».
  - **Respaldo total** (solo administradores): menú del usuario → Usuarios y empresas → «Descargar respaldo total». Un archivo con todas las empresas, los usuarios (contraseñas cifradas con scrypt, no legibles) y sus permisos. «Restaurar respaldo total…» reemplaza todo lo del servidor; antes guarda una copia de lo que había en `/var/data/respaldos/`.
  - Además, el servidor guarda una copia diaria de cada empresa en `/var/data/respaldos/` (60 días).
- **Cambiar nombres, correos y contraseñas** (administradores): en Usuarios y empresas, el lápiz de cada empresa cambia su nombre; el lápiz de cada usuario cambia nombre, correo, contraseña, acceso y si está activo. Cada usuario puede cambiar su propia contraseña desde su menú.
- Olvido de la contraseña del administrador: en Render, agregar la variable `ADMIN_RESET=1` (con `ADMIN_EMAIL` y la nueva `ADMIN_PASSWORD`), reiniciar, entrar y después quitar `ADMIN_RESET`.
- No incluye avisos por correo: para eso hace falta además un servicio de envío de correos.
- Probarlo en una computadora: `node server/server.js` (Node 18 o más nuevo) con las variables `ADMIN_EMAIL` y `ADMIN_PASSWORD`, y abrir `http://localhost:3000`.

## Publicar sin usuarios (sitio estático gratis)

- En Render: **New → Static Site**, Build Command vacío (o `echo ok`) y Publish Directory `public`. O usar `render-estatico/render.yaml` como blueprint (copiándolo a la raíz).
- O abrir `public/index.html` con doble clic en Chrome o Edge. Internet solo hace falta para la tipografía y para importar o exportar Excel.
- En este modo los datos se guardan en el **navegador** de quien usa la herramienta (localStorage): cada computadora tiene sus propios datos. **Datos y respaldos → Descargar respaldo (.json)** guarda todo en un archivo; **Restaurar respaldo** lo vuelve a cargar en otro equipo.
- El HTML publicado no contiene datos de ninguna empresa: al abrirlo por primera vez muestra una empresa ficticia de ejemplo.

## Cargar la planilla de flujo de caja

- **Importar planilla Excel** (en el aviso de datos de ejemplo o en Configuración → Datos y respaldos). Lee planillas con meses en columnas y conceptos en la columna A, como «Flujo de Caja a Diciembre 2026».
- O bien **Restaurar respaldo** con `datos/datos-iniciales.json`, que ya tiene esa planilla importada.

Supuestos de la importación:

- **Deudas a cobrar** → cuentas por cobrar por cliente (saldo inicial), con vencimiento el último día del mes (opción: día 15).
- **Ventas proyectadas** → plan comercial. Si la celda tenía una fórmula `cantidad*precio` (por ejemplo `=99*650`) se cargan cantidad y precio.
- Resto de conceptos → líneas del flujo con su proyección repartida en las 4 semanas del mes.
- Los meses anteriores al mes actual se toman como reales y quedan cerrados; sus deudas a cobrar, como cobradas.
- Si el total de un grupo no coincide con la suma de su detalle (por ejemplo, un total escrito a mano) se agrega una línea «sin detalle» con la diferencia.
- Control: el saldo final de diciembre 2027 coincide con la planilla (US$ −3.684,82).

## Criterios de cálculo

- **Semanas**: S1 del 1 al 7, S2 del 8 al 14, S3 del 15 al 21 y S4 del 22 a fin de mes. Así el flujo semanal suma exacto al mensual.
- **Flujo actualizado** (real + proyección): en semanas cerradas usa solo el real; en semanas abiertas usa el real si ya se cargó y, si no, la proyección. Los cobros vencidos sin registrar se esperan en la semana actual.
- **Plan comercial**: la venta planificada de cada mes se reparte en las 4 semanas y su cobro se agenda según el plazo de la línea. El plan de meses pasados que no se vendió deja de proyectarse.
- **EERR**: ventas y costo de ventas salen del plan y de las ventas registradas. Los gastos salen de las líneas del flujo según su **tipo** (base caja). Las compras de materia prima van a inventario y se reconocen como costo al vender. La depreciación sale de la depreciación mensual de los bienes existentes más las inversiones del flujo. El IRE (10 %) se provisiona sobre el resultado acumulado de cada año.
- **Balance**: caja = saldo del flujo; cuentas por cobrar = saldo inicial + ventas − cobranzas; inventario = inicial + compras − costo de ventas; bienes de uso = inicial + inversiones − depreciaciones; préstamos = inicial + préstamos recibidos − amortizaciones (porción corriente: amortizaciones de los próximos 12 meses); impuestos = inicial + IRE − pagos; patrimonio = inicial + resultados. Cuadra por construcción si el balance inicial cuadra.
- **IVA**: ventas y compras llevan su tasa (10 %, 5 % o exenta). Débito − crédito de cada mes se paga el mes siguiente; el saldo a favor se arrastra. Las líneas manuales del flujo son montos de caja (sin separar IVA).
- **Producción y stock**: producción del mes = ventas (registradas + plan) del mismo mes, o del mes siguiente si se produce con anticipación. Consumo de cada insumo = producción × receta. Compras planificadas (desde el mes actual) = lo necesario para cubrir el consumo y dejar el stock mínimo; se compran el mes del consumo o antes (anticipo, por ejemplo importaciones) y se pagan el día 15 más el plazo del insumo. Costo de ventas de productos con receta = toneladas vendidas × costo promedio de la materia prima del mes. La conversión (energía, mano de obra) se muestra en el costo por tonelada, pero en el EERR sale de las líneas del flujo: para que entre en el margen bruto, ponerles el tipo «Costo de producción». El plan comercial de esos productos tiene que estar en toneladas.
- **Gastos variables**: % × (ventas registradas + pendiente del plan) del mes, en la última semana del mes (o del mes siguiente). Presupuesto: % × ventas del plan.
- **Descuento de documentos**: costo = monto × tasa anual × días hasta el vencimiento / 365 + gastos.
- **Conciliación**: el saldo de cada cuenta se convierte a la moneda de los reportes al tipo de cambio de Configuración y se compara con el saldo real de la herramienta al cierre de la semana. El ajuste va a «Ajustes de conciliación» (otros ingresos; negativo si falta plata).
- **Indicadores**: días de cobro = promedio ponderado por monto de los días entre la venta y cada cobro (los descuentos no cuentan como cobro del cliente); cobertura = saldo de hoy / egresos semanales promedio de las próximas 12 semanas; punto de equilibrio = gastos fijos / margen de contribución.
- **Precisión**: al empezar cada mes se guarda sola una foto de la proyección (ventas, ingresos, egresos, saldo y resultado por mes). En Indicadores se compara cada foto con lo que pasó en los meses ya terminados.
- **Moneda**: los reportes están en la moneda elegida en Configuración. Cambiarla convierte los montos cargados al tipo de cambio configurado.

## Personalizar

- Nombre de la herramienta: en `public/index.html`, etiqueta `<title>` y texto «Timón» del encabezado.
- Cargar datos iniciales automáticamente (solo en un sitio privado): publicar un respaldo `.json` junto al HTML y agregar antes del script principal:
  `<script>window.TIMON_DATOS_INICIALES = 'datos-iniciales.json'</script>`
