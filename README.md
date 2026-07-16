# Recuerdos NFC

App de viajes con galerias minimalistas, enlaces NFC por viaje y sincronizacion con Supabase.

## Que cambia ahora

- Los viajes y las fotos nuevas se guardan en Supabase.
- Si ya tenias viajes en este Mac, la app intenta subirlos automaticamente la primera vez que abras esta version con Supabase activo.
- Si la migracion automatica no se lanza o quieres repetirla, tienes el boton `Subir viajes actuales`.

## Preparar Supabase

1. Abre el editor SQL de tu proyecto Supabase.
2. Ejecuta el archivo [supabase-setup.sql](/Users/ruben/Desktop/Inventos/NFC recuerdo viaje/supabase-setup.sql).

Esto crea:

- La tabla `trips`
- La tabla `trip_images`
- El bucket publico `trip-images`
- Las politicas necesarias para leer, subir, editar y borrar

## Arrancar la app local

```bash
python3 server.py 4179
```

Luego abre:

```text
http://127.0.0.1:4179
```

## Migrar lo que ya tienes

Importante: la migracion de fotos y viajes existentes solo puede hacerse desde el mismo navegador del Mac donde ya habias usado la app antes, porque esos datos siguen dentro de IndexedDB.

Pasos:

1. Ejecuta el SQL en Supabase.
2. Abre esta app en tu Mac.
3. Espera a que conecte con Supabase.
4. Si hay viajes locales guardados, la app intentara subirlos sola.
5. Si no lo hace, pulsa `Subir viajes actuales`.

## Publicarla para usarla en el telefono

Despues de tener los datos en Supabase, ya puedes publicar la parte frontal donde quieras:

- GitHub Pages
- Netlify
- Vercel

Tus viajes seguiran estando disponibles porque ya no dependen solo del navegador local.

## Nota importante

Ahora mismo la configuracion esta pensada para simplicidad: cualquier persona que abra tu app publicada podria editar viajes si conoce la URL. Para uso personal funciona, pero si quieres luego te dejo esto cerrado con autenticacion o con un backend privado.
