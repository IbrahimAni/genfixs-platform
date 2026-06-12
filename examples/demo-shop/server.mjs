import { createServer } from 'node:http';

/**
 * Minimal real web app used to demonstrate GenFixs verification end-to-end:
 * a checkout page whose "apply discount" control carries the RENAMED testid
 * (apply-discount-code) — i.e. the app after the drift that broke the suite.
 * GenFixs's healed test must go green against this app in a real browser.
 */
const CHECKOUT_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Acme Shop — Checkout</title></head>
  <body>
    <main>
      <h1>Checkout</h1>
      <p>Subtotal: $100.00</p>
      <input data-testid="coupon-input" placeholder="Coupon code" />
      <button data-testid="apply-discount-code">Apply</button>
      <p>Total: <span class="cart-total">$100.00</span></p>
    </main>
    <script>
      document.querySelector('[data-testid=apply-discount-code]').addEventListener('click', () => {
        const code = document.querySelector('[data-testid=coupon-input]').value;
        if (code === 'SAVE10') {
          document.querySelector('.cart-total').textContent = '$90.00';
        }
      });
    </script>
  </body>
</html>`;

export function startDemoShop(port = 0) {
  const server = createServer((req, res) => {
    if (req.url === '/checkout' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(CHECKOUT_PAGE);
    } else {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const { port } = await startDemoShop(Number(process.env.PORT ?? 4100));
  console.log(`demo-shop on http://127.0.0.1:${port}/checkout`);
}
