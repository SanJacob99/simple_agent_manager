import fs from 'fs';

// 1. First we need to move the safeFetch abstraction to url-validator.ts
let urlValidatorContent = fs.readFileSync('server/tools/builtins/web/url-validator.ts', 'utf-8');

const safeFetchFunc = `
export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const MAX_REDIRECTS = 5;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const { url: validatedUrl, dispatcher } = await validateSafeUrl(currentUrl);

    let resp: Response;
    try {
      resp = await fetch(validatedUrl, {
        ...options,
        redirect: 'manual',
        dispatcher,
      } as RequestInit & { dispatcher: unknown });
    } finally {
      void dispatcher.close().catch(() => {});
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (location) {
        if (hop >= MAX_REDIRECTS) {
          throw new Error(\`Fetch error: too many redirects (>\${MAX_REDIRECTS})\`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
    }

    return resp;
  }
}
`;

if (!urlValidatorContent.includes('export async function safeFetch')) {
  urlValidatorContent += `\n${safeFetchFunc}`;
  fs.writeFileSync('server/tools/builtins/web/url-validator.ts', urlValidatorContent, 'utf-8');
}

// 2. Update web-fetch.ts to use safeFetch
let webFetchContent = fs.readFileSync('server/tools/builtins/web/web-fetch.ts', 'utf-8');

// Replace imports
webFetchContent = webFetchContent.replace("import { validateSafeUrl } from './url-validator.js';\nimport type { Agent } from 'undici';", "import { safeFetch } from './url-validator.js';");

// Replace the loop logic
const webFetchLoopMatch = webFetchContent.match(/const MAX_REDIRECTS = 5;\n\s*let currentUrl = params\.url;[\s\S]*?continue;\n\s*}\n\s*}\n\n/);

if (webFetchLoopMatch) {
  const newWebFetchCall = `const resp = await safeFetch(params.url, {
          method: params.method || 'GET',
          signal,
        });

        `;
  webFetchContent = webFetchContent.replace(webFetchLoopMatch[0], newWebFetchCall);
  fs.writeFileSync('server/tools/builtins/web/web-fetch.ts', webFetchContent, 'utf-8');
}


// 3. Update show-image.ts to use safeFetch
let showImageContent = fs.readFileSync('server/tools/builtins/image/show-image.ts', 'utf-8');
showImageContent = showImageContent.replace("import { validateSafeUrl } from '../web/url-validator.js';", "import { safeFetch } from '../web/url-validator.js';");

const showImageFetchPattern = /const \{ url: validatedUrl, dispatcher \} = await validateSafeUrl\(imagePath\);\n\s*const resp = await fetch\(validatedUrl, \{\n\s*dispatcher,\n\s*redirect: 'manual',\n\s*\} as RequestInit & \{ dispatcher: unknown \}\);/;

showImageContent = showImageContent.replace(showImageFetchPattern, "const resp = await safeFetch(imagePath);");

fs.writeFileSync('server/tools/builtins/image/show-image.ts', showImageContent, 'utf-8');


// 4. Update image-analyze.ts to use safeFetch
let imageAnalyzeContent = fs.readFileSync('server/tools/builtins/image/image-analyze.ts', 'utf-8');
imageAnalyzeContent = imageAnalyzeContent.replace("import { validateSafeUrl } from '../web/url-validator.js';", "import { safeFetch } from '../web/url-validator.js';");

const imageAnalyzeFetchPattern = /const \{ url: validatedUrl, dispatcher \} = await validateSafeUrl\(imagePath\);\n\s*const resp = await fetch\(validatedUrl, \{\n\s*dispatcher,\n\s*redirect: 'manual',\n\s*\} as RequestInit & \{ dispatcher: unknown \}\);/;

imageAnalyzeContent = imageAnalyzeContent.replace(imageAnalyzeFetchPattern, "const resp = await safeFetch(imagePath);");

fs.writeFileSync('server/tools/builtins/image/image-analyze.ts', imageAnalyzeContent, 'utf-8');
