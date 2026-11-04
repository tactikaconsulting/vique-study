# Vique Study

Piloto web independiente. Node.js 22 o posterior. Ejecutar con `npm start`.

En Railway, crear un servicio separado con comando de inicio `npm start`. Para conservar los datos entre despliegues, montar un volumen en /data y establecer DATABASE_PATH=/data/study.sqlite.

Variables requeridas para la demo:
- INSTRUCTOR_KEY: clave privada para publicar y entrar como instructor.
- LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET: credenciales de un proyecto LiveKit exclusivo de Study.

Publicar una sesión que empiece dentro de los próximos 15 minutos. Desde un segundo navegador reservar el cupo y entrar como alumno. En el primer navegador entrar como instructor. Otorgar permisos de cámara y micrófono en ambos dispositivos. La entrada del alumno se conserva en el navegador que realizó la reserva. Los pagos quedan fuera del piloto.

Para la demo grupal, publicar un taller y reservar desde varios navegadores. La capacidad del piloto se fija entre 1 y 12 alumnos por taller.
