// Next.js 15.5 no longer ships an ambient declaration for side-effect CSS
// imports (e.g. `import './globals.css'`). Declare it so TypeScript accepts it.
declare module '*.css'
