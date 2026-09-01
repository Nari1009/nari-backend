# Seeds y persistencia

El comando `npm start` solo prepara la estructura necesaria, garantiza el esquema del administrador y arranca la API. No ejecuta seeds ni modifica productos, opciones de catálogo o configuraciones existentes.

Los comandos siguientes son manuales y no deben agregarse al Build Command, Start Command, hooks de instalación ni despliegues de Render:

- `npm run seed:dev`: carga datos iniciales solo en un entorno de desarrollo.
- `npm run seed:catalog`: aplica metadata de catálogo explícitamente.
- `npm run seed:product-details`: aplica fichas de producto explícitamente.
- `npm run normalize:skin-types`: normaliza tipos de piel explícitamente.

Las operaciones manuales que pueden modificar registros están bloqueadas cuando `NODE_ENV=production`, salvo que se establezca conscientemente `ALLOW_PRODUCTION_SEED=true` para esa ejecución puntual.
