export function mountWorkspaceMap(diagram) {
  const svg=diagram.querySelector('.map-lines'),core=diagram.querySelector('.map-core img');
  const projects=[...diagram.querySelectorAll('.map-projects .map-node')];
  const resources=[...diagram.querySelectorAll('.map-resources .map-node')];
  let frame;
  function draw(){
    const bounds=diagram.getBoundingClientRect(),center=core.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    svg.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
    const centerY=center.top-bounds.top+center.height/2;
    svg.replaceChildren();
    for(const node of [...projects,...resources]){
      const box=node.getBoundingClientRect(),incoming=projects.includes(node);
      const from={x:incoming?box.right-bounds.left:center.right-bounds.left+7,y:incoming?box.top-bounds.top+box.height/2:centerY};
      const to={x:incoming?center.left-bounds.left-7:box.left-bounds.left,y:incoming?centerY:box.top-bounds.top+box.height/2};
      const curve=Math.max(12,Math.abs(to.x-from.x)*.45);
      const line=document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d',`M${from.x},${from.y} C${from.x+curve},${from.y} ${to.x-curve},${to.y} ${to.x},${to.y}`);
      line.classList.add('map-link');
      if(incoming){line.dataset.mapProject=node.dataset.openProject;line.classList.toggle('is-working',node.dataset.working==='true');}
      line.dataset.mapTarget=node.dataset.openProject||node.dataset.view;
      line.style.animationDelay=`${-[...projects,...resources].indexOf(node)*.6}s`;
      svg.append(line);
    }
  }
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};
  const observer=new ResizeObserver(schedule);observer.observe(diagram);observer.observe(core);
  for(const node of [...projects,...resources])observer.observe(node);
  function highlight(event){const node=event.target.closest('.map-node');for(const line of svg.children)line.classList.toggle('is-highlighted',!!node&&line.dataset.mapTarget===(node.dataset.openProject||node.dataset.view));}
  function clear(){for(const line of svg.children)line.classList.remove('is-highlighted');}
  diagram.addEventListener('pointerover',highlight);diagram.addEventListener('pointerleave',clear);diagram.addEventListener('focusin',highlight);diagram.addEventListener('focusout',clear);
  schedule();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();diagram.removeEventListener('pointerover',highlight);diagram.removeEventListener('pointerleave',clear);diagram.removeEventListener('focusin',highlight);diagram.removeEventListener('focusout',clear);};
}
