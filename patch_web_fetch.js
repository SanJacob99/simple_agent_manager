import fs from 'fs';
let content = fs.readFileSync('server/tools/builtins/web/web-fetch.ts', 'utf-8');
content = content.replace("        }\n      } catch (e) {", "      } catch (e) {");
fs.writeFileSync('server/tools/builtins/web/web-fetch.ts', content, 'utf-8');
