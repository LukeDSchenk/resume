# Resume

A really simple tab manager.

This project was created with [Goose](https://github.com/block/goose), using OpenAI's GPT-5 as a backend. You can see the inputs that were given in the included file `resume.jsonl`.

## How to load in Firefox (Temporary Add-on)

1. Open Firefox and navigate to: about:debugging#/runtime/this-firefox
2. Click “Load Temporary Add-on…”
3. Select the manifest.json inside your resume/ folder.
4. You should see a new toolbar icon named “Resume”. Click it to open the popup.

Note: Temporary add-ons are unloaded on browser restart. To persist, package and sign via AMO if you plan to distribute.
