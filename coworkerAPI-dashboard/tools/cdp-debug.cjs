// Local test helper only. Not used or packaged by CoworkerAPI.
const http = require('node:http');
const WebSocket = require('ws');
const kind = process.argv[2];
const expression = process.argv.slice(3).join(' ');
http.get('http://127.0.0.1:9333/json/version', response => {
  let body = '';
  response.on('data', chunk => body += chunk);
  response.on('end', () => {
    const socket = new WebSocket(JSON.parse(body).webSocketDebuggerUrl);
    let sessionId;
    let clickPoint;
    socket.on('open', () => socket.send(JSON.stringify({id: 1, method: 'Target.getTargets'})));
    socket.on('message', message => {
      const value = JSON.parse(message.toString());
      if (value.id === 1) {
        const target = value.result.targetInfos.find(item => (kind === 'chat' || kind === 'chat-click')
          ? item.url.startsWith('https://chatgpt.com/')
          : kind === 'widget'
            ? item.type === 'iframe' && item.url.includes('web-sandbox.oaiusercontent.com')
            : item.title === 'Coworker' && item.url.startsWith('file:'));
        if (!target) throw Error(`${kind} target not found`);
        socket.send(JSON.stringify({id: 2, method: 'Target.attachToTarget', params: {targetId: target.targetId, flatten: true}}));
      } else if (value.id === 2) {
        sessionId = value.result.sessionId;
        const code = kind === 'chat-click'
          ? `(() => { const element = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(expression)}); if (!element) throw Error('button not found'); const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`
          : expression;
        socket.send(JSON.stringify({id: 3, sessionId, method: 'Runtime.evaluate', params: {expression: code, awaitPromise: true, returnByValue: true}}));
      } else if (value.id === 3) {
        if (kind === 'chat-click' && value.result.result.value) {
          const { x, y } = value.result.result.value;
          clickPoint = { x, y };
          socket.send(JSON.stringify({id: 4, sessionId, method: 'Input.dispatchMouseEvent', params: {type: 'mousePressed', x, y, button: 'left', clickCount: 1}}));
          return;
        }
        process.stdout.write(JSON.stringify(value.result.result));
        process.exit(0);
      } else if (value.id === 4) {
        socket.send(JSON.stringify({id: 5, sessionId, method: 'Input.dispatchMouseEvent', params: {type: 'mouseReleased', ...clickPoint, button: 'left', clickCount: 1}}));
      } else if (value.id === 5) {
        process.stdout.write(JSON.stringify({ clicked: expression }));
        process.exit(0);
      }
    });
  });
});
