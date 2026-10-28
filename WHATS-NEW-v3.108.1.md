# v3.108.1

- Personal link: login is no longer asked again after every deploy / server restart — sessions are now signed cookies (still expire after 6h, still invalidated when the admin changes credentials / sections or disables the link, and on Lock).
- "New version available" popup works again: sw.js version now follows the release version (it was stuck at v315). From now on bump sw.js CACHE_NAME together with package.json (a test enforces it).
