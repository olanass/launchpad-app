async function verify() {
  const p1 = await fetch('http://localhost:4020/p/pay_cef5e0ab17e1');
  const t1 = await p1.text();
  console.log('GET /p/pay_cef5e0ab17e1 Status:', p1.status);
  console.log('Has <base href="/">:', t1.includes('<base href="/" />'));
  console.log('Has href="/style.css":', t1.includes('href="/style.css"'));
  console.log('Has src="/app.js":', t1.includes('src="/app.js"'));

  const css = await fetch('http://localhost:4020/style.css');
  console.log('GET /style.css Status:', css.status, 'Type:', css.headers.get('content-type'));

  const js = await fetch('http://localhost:4020/app.js');
  console.log('GET /app.js Status:', js.status, 'Type:', js.headers.get('content-type'));

  const meta = await fetch('http://localhost:4020/api/paywalls/pay_cef5e0ab17e1');
  const metaData = await meta.json();
  console.log('GET /api/paywalls/pay_cef5e0ab17e1 Status:', meta.status);
  console.log('Paywall Title:', metaData.paywall?.title);
  console.log('Paywall Price:', metaData.paywall?.price, metaData.paywall?.currency);
  console.log('Paywall Asset:', metaData.paywall?.asset?.originalName);
}

verify();
