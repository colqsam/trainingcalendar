[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[dev]
  command = "npm run dev"
  targetPort = 5173

# Let function calls through untouched before the SPA catch-all below.
[[redirects]]
  from = "/.netlify/functions/*"
  to = "/.netlify/functions/:splat"
  status = 200

# SPA fallback so client routing / refreshes resolve to index.html
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
