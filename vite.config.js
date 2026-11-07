import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {copyFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export default defineConfig({
  plugins:[{
    name:'preserve-classic-page-scripts',
    closeBundle(){
      // These existing scripts intentionally stay classic (including QR analytics).
      for(const file of ['script.js','QR/script.js','QR/links.json','assets/pauly-cee-roger-sanchez-another-one-remix.mp3','assets/pauly-cee-movin-to-the-sun-remix-preview.mp3']){
        const target=fileURLToPath(new URL('./dist/'+file,import.meta.url));
        mkdirSync(dirname(target),{recursive:true});
        copyFileSync(fileURLToPath(new URL('./'+file,import.meta.url)),target);
      }
    }
  }],
  build:{rollupOptions:{input:{
    main:fileURLToPath(new URL('./index.html',import.meta.url)),
    qr:fileURLToPath(new URL('./QR/index.html',import.meta.url)),
    glow:fileURLToPath(new URL('./light-me-up/index.html',import.meta.url))
  }}}
});
