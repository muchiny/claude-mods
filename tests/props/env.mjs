// Accès à l'environnement et à la console, en .mjs : tsconfig n'embarque pas les types de Node (comme tests/golden/io.mjs).
export const env = (name) => process.env[name]
export const log = (message) => console.log(message)
