# ninjamanan.ct.ws

Portfolio website featuring liquid glass effects with Three.js and WebGL.

## Project Structure

- `index.html` - Main portfolio page with liquid glass refraction effects
- `glasspanel.js` - Core glass panel component with WebGL shaders
- `styles.css` - Main stylesheet
- `assets/` - Images and media files

## Git Commit Guidelines

**IMPORTANT**: Only commit and push production-ready files. Do NOT commit:
- Test files (`test/`, `*test*.html`, `*test*.js`)
- Bundled dependencies (`three-bundle.js`, `three-full.min.js`)
- Development server files (`server.js`, `open_test.js`)
- Standalone/experimental versions (`index-bundled.html`, `index-standalone.html`)

### Before Committing
1. Review changes with `git status`
2. Use `git add <specific-files>` instead of `git add .` or `git add -A`
3. Only stage files that are part of the production website

## Development

The project uses:
- Three.js for 3D rendering
- WebGL for liquid glass refraction effects
- Physical refraction with dynamic screen-space shaders
