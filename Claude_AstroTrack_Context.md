# CLAUDE SYSTEM CONTEXT & TRAINING DOCUMENT: PROJECT ORBITAL RETRO

## 1. PROJECT OVERVIEW
**Project Name:** Orbital Retro (Working Title)
**Objective:** A real-time space directory and planetary/asteroid tracking dashboard.
**Aesthetic:** 1970s/1980s Retro-Futuristic Sci-Fi (Star Wars Targeting Computers, Star Trek LCARS, Alien Nostromo terminals).
**Target Audience:** Space enthusiasts, data nerds, and sci-fi fans.

**Developer Profile (Context for Claude):** The primary developer is an Information Technology undergraduate with established experience in building full-stack automated data extraction pipelines (Python) and complex, multi-form data visualizations. You do not need to over-explain basic API fetching or standard data structures. Focus your outputs on advanced state management, Three.js WebGL optimizations, and pixel-perfect CSS/Shader execution to match the strict aesthetic guidelines.

---

## 2. TECHNOLOGY STACK & ARCHITECTURE

### Frontend (Visuals & Interactivity)
* **Core:** HTML5, CSS3, modern vanilla JavaScript (ES6+) or a lightweight framework (like React/Vue if specified later, but default to modular JS).
* **3D Rendering:** `Three.js` (for interactive planetary bodies, orbital paths, and asteroid wireframes).
* **2D Data Visualization:** `D3.js` or HTML5 Canvas (for tactical maps, charts, and flat radar overlays).
* **Styling:** CSS Grid/Flexbox heavily utilized for complex dashboard layouts. Custom CSS variables for theming.

### Backend & Data Pipeline
* **Data Extraction Engine:** Python (requests, pandas, or asyncio for high-throughput). The system will aggregate multiple APIs into a unified JSON stream.
* **Caching/Storage:** Local JSON files for static/historical data; memory cache for real-time tracking to avoid rate limits.

### Primary Data Sources (APIs)
1.  **NASA NeoWs (Near Earth Object Web Service):** Primary source for asteroid tracking, hazard status, velocity, and distance.
2.  **JPL Horizons:** For precise ephemeris data (exact orbital coordinates of planets/moons).
3.  **SpaceX API:** For current satellite and launch data.
4.  **NASA APOD:** Background imagery and daily space context.

---

## 3. AESTHETIC & UI/UX GUIDELINES
When generating UI components, CSS, or Canvas drawing logic, adhere strictly to these two dominant visual languages. Never mix modern, clean web design (like Material UI or Apple-style glassmorphism) into the project. 

### Theme A: "The Empire / Rebellion Targeting Computer" (Star Wars style)
* **Color Palette:** Deep black background (`#000000`), stark glowing vector lines (Neon Red `#ff3333`, Acid Green `#33ff33`, or Cyan `#00ffff`).
* **Typography:** Monospace only (e.g., *VT323*, *Share Tech Mono*). Uppercase text heavily preferred.
* **Visual Motifs:**
    * Wireframe 3D models (no textures, just edge lines).
    * Crosshairs, concentric targeting rings, and angular brackets `[ ]` surrounding data points.
    * Heavy CRT scanline overlays, slight screen curvature (`border-radius`), and phosphor flicker animations.
    * Data updates should "type out" or flash abruptly.

### Theme B: "Federation Library System" (Star Trek LCARS style)
* **Color Palette:** Black background (`#000000`), vibrant flat pastel/neon blocks (Peach `#ff9966`, Lavender `#cc99cc`, Pale Blue `#99ccff`, Gold `#ffcc00`).
* **Typography:** Sans-serif, condensed (e.g., *Antonio*, *Oswald*).
* **Visual Motifs:**
    * Thick, rounded pill-shaped buttons and sweeping elbow joints outlining the screen.
    * Dense, columnar data layouts with right-aligned text blocks.
    * No gradients, no drop shadows. Everything is flat, brightly lit, and highly organized.
    * Auditory UI cues (visualized as blinking square equalizer bars).

---

## 4. CLAUDE CODING Directives (RULES OF ENGAGEMENT)

Whenever the developer asks for code, strictly follow these constraints:

### A. Three.js / WebGL Generation
1.  **Optimization:** Always use `requestAnimationFrame` properly. Dispose of unused geometries and materials to prevent memory leaks, especially when rendering hundreds of asteroid objects.
2.  **Shaders:** When asked for a "retro look" in 3D, default to writing custom GLSL shaders (or Three.js `WireframeGeometry` + `LineBasicMaterial` with `UnrealBloomPass` post-processing) rather than standard mesh materials.

### B. CSS and Layouts
1.  **Grid Systems:** Use `display: grid` for complex dashboard layouts. Avoid absolute positioning unless placing overlays (like CRT scanlines).
2.  **Glow Effects:** Use `text-shadow: 0 0 5px var(--glow-color)` for text, and `box-shadow` or SVG filters for glowing panels.
3.  **Animations:** Keep animations hardware-accelerated (`transform`, `opacity`). Build a standard `.scanline` and `.flicker` class that can be applied to any container.

### C. Python Data Processing
1.  **Resilience:** API ingestion scripts must include retry logic (`urllib3.util.retry` or `tenacity`) and strict timeout parameters.
2.  **Data Transformation:** Output data must be flattened or structured specifically for D3.js or Three.js consumption. Avoid nested dictionaries where a flat array of objects is more performant for the frontend.

---

## 5. STARTER PROMPT TEMPLATES FOR DEVELOPER
*(Developer, use these templates when asking me to generate specific modules)*

**Prompt 1: The NASA Data Ingestor**
> "Claude, using the project context, write a Python script that hits the NASA NeoWs API for the next 7 days. Filter the response to only include objects with an estimated diameter > 50 meters. Output the final data structure as a JSON file formatted for direct import into a Three.js scene."

**Prompt 2: The Tactical Radar Component**
> "Claude, generate an HTML5 Canvas component with vanilla JS that visualizes a 2D top-down radar. Apply the 'Targeting Computer' aesthetic from the context doc. Draw a central planet, and animate 5 glowing dots orbiting it. Include a CRT scanline CSS overlay on the canvas."

**Prompt 3: The LCARS Dashboard Layout**
> "Claude, build a CSS Grid layout mimicking the 'Federation Library System' aesthetic. Create a left-side navigation sidebar with a rounded elbow joint at the top, and a main content area for a data table. Use the specific pastel color palette from the documentation."
