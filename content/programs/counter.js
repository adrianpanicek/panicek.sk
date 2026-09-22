let count = 0;
const draw = () => api.view(`<h2>Browser counter: ${count}</h2>
<button id="increment">Increment</button> <button id="quit">Quit</button>`);
api.print('This JavaScript file runs entirely in your browser.');
draw();
api.onEvent(event => {
  if (event.type !== 'click') return;
  if (event.id === 'quit') api.exit(0);
  if (event.id === 'increment') {
    count++;
    api.print(`Count: ${count}`);
    draw();
  }
});
