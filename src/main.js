import { initJsPsych } from "jspsych";
import htmlKeyboardResponse from "@jspsych/plugin-html-keyboard-response";
import jsPsychVirtualChinrest from "@jspsych/plugin-virtual-chinrest";
import jsPsychHtmlButtonResponse from "@jspsych/plugin-html-button-response";
// import imageButtonResponse from '@jspsych/plugin-image-button-response';

import './style.css';
const jsPsych = initJsPsych({

});
const timeline = [];
const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;
const DURATION = 200; // 动画时长
const CH_DURATION = 500; // 十字准线额外显示时长
const ColorAnimationTime = 500;

const sight_array=[
[NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN],
[NaN,NaN,NaN,0,15,12,22,NaN,NaN,NaN],
[NaN,NaN,0,0,7,15,23,21,NaN,NaN],
[NaN,0,10,3,20,28,25,22,26,NaN],
[0,0,0,0,0,26,26,4,26,NaN],
[0,0,0,0,0,25,25,20,26,NaN],
[NaN,0,0,0,0,24,24,25,24,NaN],
[NaN,NaN,0,0,0,24,23,22,NaN,NaN],
[NaN,NaN,NaN,0,0,14,23,NaN,NaN,NaN],
[NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN]
]
function linspace(start, end, num) {
    const step = (end - start) / (num - 1);
    return Array.from({ length: num }, (_, i) => start + i * step);
}

const size = 10;
const xValues = linspace(-30, 30, size);  // left to right
const yValues = linspace(30, -30, size);  // top to bottom

const angleArray = yValues.map(y => xValues.map(x => [x, y]));

// console.log(angleArray);
// 使用VirtualChinrest结果的degToPixel函数
function degToPixelWithChinrest(thetaXDeg, thetaYDeg, chinrestData, screenCenter = [screenWidth/2, screenHeight/2]) {
    const px2deg = chinrestData?.px2deg;
    if (!px2deg || px2deg === 0) {
        // fallback
        console.warn('Invalid px2deg, fallback to degToPixel', px2deg, chinrestData);
        return degToPixel(thetaXDeg, thetaYDeg, 20, 50, 50, screenCenter);
    }
    // 1 px = px2deg deg  =>  1 deg = 1/px2deg px
    const dxPx = thetaXDeg * px2deg ;
    const dyPx = thetaYDeg * px2deg ;
    const pixelX = Math.round(screenCenter[0] + dxPx);
    const pixelY = Math.round(screenCenter[1] + dyPx);

    // 日志
    console.log('degToPixelWithChinrest', {thetaXDeg, thetaYDeg, px2deg, dxPx, dyPx, pixelX, pixelY});
    return [pixelX, pixelY];
}

// 保留原来的函数作为后备
function degToPixel(thetaXDeg, thetaYDeg, lCm = 20, pxPerCmX = 50, pxPerCmY = 50, screenCenter = [screenWidth/2, screenHeight/2]) {
    // Convert angle to cm displacement from fixation point
    const dxCm = 2 * lCm * Math.tan((thetaXDeg / 2) * Math.PI / 180);
    const dyCm = 2 * lCm * Math.tan((thetaYDeg / 2) * Math.PI / 180);

    // Convert to pixel displacement
    const dxPx = dxCm * pxPerCmX;
    const dyPx = dyCm * pxPerCmY;

    // Convert to screen coordinates (note y is flipped)
    const pixelX = Math.round(screenCenter[0] - dxPx);
    const pixelY = Math.round(screenCenter[1] + dyPx);
	// console.log(pixelX, pixelY);
    return [pixelX, pixelY];
}

// Function to create motion stimulus
function createMotionStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, signalDirection = [-1, 1], position = 'left_upper') {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	

	<svg id="stimulus" width="100%" height="100%"></svg>

    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // D3.js is already loaded in HTML, initialize animation directly
	//   console.log(sight_array, angleArray);
      initMotionAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData, signalDirection, position);
    }
  };
}

// Function to create drifting grating stimulus
function createDriftingGratingStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper') {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
	<svg id="stimulus" width="100%" height="100%"></svg>

    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // Initialize drifting grating animation
      initDriftingGratingAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData, position);
    }
  };
}

// Function to create grid stimulus
function createGridStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', centerColor = 'black', centerPercentage = 25) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
    <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // Initialize grid stimulus
      initGridStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData, position, centerColor, centerPercentage);
    }
  };
}

// Function to create bar chart stimulus
function createBarChartStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', heights = [1, 1]) {
  return {
    type: htmlKeyboardResponse,
    stimulus: `
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			background-color: #ccc;
			overflow: hidden;
		}
	</style>
	
     <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: "NO_KEYS",  // No key press allowed to skip
    trial_duration: DURATION, // Duration 5 seconds
    on_load: function() {
      // Initialize bar chart stimulus
      initBarChartStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData, position, heights);
    }
  };
}

// 十字准线全局参数
const crosshairLength = 30; // 十字长度
const crosshairStroke = 2;  // 线宽

// 通用十字准线绘制函数
function drawCrosshair(svg, width, height, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  // 移除旧的十字
  svg.selectAll('.crosshair').remove();
  const centerX = width / 2;
  const centerY = height / 2;
  // 水平线
  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX - crosshairLen / 2)
    .attr('y1', centerY)
    .attr('x2', centerX + crosshairLen / 2)
    .attr('y2', centerY)
    .attr('stroke', 'black')
    .attr('stroke-width', crosshairStrokeWidth);
  // 垂直线
  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX)
    .attr('y1', centerY - crosshairLen / 2)
    .attr('x2', centerX)
    .attr('y2', centerY + crosshairLen / 2)
    .attr('stroke', 'black')
    .attr('stroke-width', crosshairStrokeWidth);
}

// Function to initialize motion animation
function initMotionAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, signalDirection = [-1, 1], position = 'left_upper', crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
	// 根据位置参数设置动画中心位置
	let animationCenterX, animationCenterY;
	const offset = 100;
	
	switch(position) {
		case 'left_upper':
			animationCenterX = width / 2 - offset;
			animationCenterY = height / 2 - offset;
			break;
		case 'left_lower':
			animationCenterX = width / 2 - offset;
			animationCenterY = height / 2 + offset;
			break;
		case 'right_upper':
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 - offset;
			break;
		case 'right_lower':
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 + offset;
			break;
		default:
			animationCenterX = width / 2 + offset;
			animationCenterY = height / 2 + offset;
	}
  const radius = 80;
  const dotRadius = 4;
  const numDots = 30;
  const numSignalDots = 20;
  const motionSpeed = 3;

  let interval = null;
  let dots = [];
  let directions = [];
  let animationTimeout = null;

  function drawCircle() {
    // Clear previous circles
    svg.selectAll("circle").remove();
    svg.selectAll(".crosshair").remove();
    
    // Draw light ring at the lost view center
    svg.append("circle")
      .attr("cx", animationCenterX)
      .attr("cy", animationCenterY)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", "0");

    // 绘制屏幕中央的十字准线
    drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
  }

  function initializeDots() {
    // Clear previous dots
    svg.selectAll("circle:not(:first-child)").remove();
    dots = [];
    directions = [];

    for (let i = 0; i < numDots; i++) {
      let x, y;
      while (true) {
        x = Math.random() * 2 * radius - radius;
        y = Math.random() * 2 * radius - radius;
        if (x * x + y * y <= radius * radius) break;
      }
      const dot = svg.append("circle")
        .attr("cx", animationCenterX + x)
        .attr("cy", animationCenterY + y)
        .attr("r", dotRadius)
        .attr("fill", i < numSignalDots ? "white" : "white"); // Signal dots in red
      dots.push({ elem: dot, x: x, y: y });

      if (i < numSignalDots) {
        directions.push(signalDirection);
      } else {
        const theta = Math.random() * 2 * Math.PI;
        directions.push([Math.cos(theta), Math.sin(theta)]);
      }
    }
  }

  function updateDots() {
    for (let i = 0; i < numDots; i++) {
      let d = dots[i];
      d.x += directions[i][0] * motionSpeed;
      d.y += directions[i][1] * motionSpeed;

      // Check if outside the light ring
      if (d.x * d.x + d.y * d.y > radius * radius) {
        while (true) {
          let x = Math.random() * 2 * radius - radius;
          let y = Math.random() * 2 * radius - radius;
          if (x * x + y * y <= radius * radius) {
            d.x = x;
            d.y = y;
            break;
          }
        }
        if (i >= numSignalDots) {
          const theta = Math.random() * 2 * Math.PI;
          directions[i] = [Math.cos(theta), Math.sin(theta)];
        }
      }

      d.elem
        .attr("cx", animationCenterX + d.x)
        .attr("cy", animationCenterY + d.y);
    }
  }

  function startAnimation() {
    const duration = 5; // Fixed 5 seconds
    const durationMs = duration * 1000;
    
    interval = setInterval(updateDots, 1000 / 60); // 60 fps
    
    animationTimeout = setTimeout(() => {
      stopAnimation();
    }, durationMs);
  }

  function stopAnimation() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }
  }

  drawCircle();
  initializeDots();
  startAnimation();
}

// Function to initialize drifting grating animation
function initDriftingGratingAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', direction = 'left', spacing = 5, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置动画中心位置
  let animationCenterX, animationCenterY;
  const offset = 100;
  
  switch(position) {
    case 'left_upper':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'left_lower':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 + offset;
      break;
    case 'right_upper':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'right_lower':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
      break;
    default:
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
  }

  function createDriftingGrating(containerId, direction = "left", driftHz = 10, spacing = 5) {
    const radius = 80;
    const stripeWidth = 3; // 固定条纹宽度为3

    // Define circular clip mask
    svg.append("clipPath")
      .attr("id", `clip-${containerId}`)
      .append("circle")
      .attr("cx", animationCenterX)
      .attr("cy", animationCenterY)
      .attr("r", radius);

    // Group for stripes (clipped)
    const g = svg.append("g")
      .attr("clip-path", `url(#clip-${containerId})`);

    // Add vertical stripes with specified spacing
    const totalWidth = stripeWidth + spacing; // 条纹宽度 + 间距
    const numStripes = Math.ceil(width / totalWidth);
    for (let i = -numStripes; i < numStripes * 2; i++) {
      g.append("rect")
        .attr("x", i * totalWidth)
        .attr("y", 0)
        .attr("width", stripeWidth)
        .attr("height", height)
        .attr("fill", "#fff");
    }

    // Circle outline
    svg.append("circle")
      .attr("cx", animationCenterX)
      .attr("cy", animationCenterY)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", "0");

    // Animation
    let phase = 0;
    const fps = 60;
    const pixelsPerSecond = driftHz * totalWidth; // 使用总宽度（条纹+间距）

    function animate() {
      phase += (direction === "left" ? -1 : 1) * (pixelsPerSecond / fps);
      g.attr("transform", `translate(${phase % totalWidth}, 0)`);
      requestAnimationFrame(animate);
    }

    animate();
  }

  createDriftingGrating("stimulus", direction, 10, spacing);   // 10Hz with specified direction and spacing
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

// Function to initialize grid stimulus
function initGridStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', centerColor = 'black', centerPercentage = 25, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置动画中心位置
  let animationCenterX, animationCenterY;
  const offset = 100;
  
  switch(position) {
    case 'left_upper':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'left_lower':
      animationCenterX = width / 2 - offset;
      animationCenterY = height / 2 + offset;
      break;
    case 'right_upper':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 - offset;
      break;
    case 'right_lower':
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
      break;
    default:
      animationCenterX = width / 2 + offset;
      animationCenterY = height / 2 + offset;
  }

  const gridSize = 10;
  const cellSize = 10;
  
  // 根据中心百分比计算半径
  let radius = Math.sqrt(centerPercentage / 100 * (gridSize * gridSize) / Math.PI);
  
  const noiseLevel = 0.45; // percentage of edge cells to flip

  function drawStimulus(svgId) {
    const svg = d3.select(svgId);
    svg.selectAll("*").remove();  // Clear previous

    // 计算网格的起始位置，使其以计算出的中心为中心
    const gridStartX = animationCenterX - (gridSize * cellSize) / 2;
    const gridStartY = animationCenterY - (gridSize * cellSize) / 2;
    
    const center = { x: 4.5, y: 4.5 };
    let grid = [];

    // Step 1–2: Make black if inside central circle
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let filled = dist < radius;
        grid.push({ x, y, filled });
      }
    }

    // Step 3: Blur edge by flipping a portion of boundary cells
    grid.forEach(cell => {
      const neighbors = [
        [0,1], [1,0], [0,-1], [-1,0]
      ];
      const isEdge = cell.filled && neighbors.some(([dx, dy]) => {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) return true;
        const neighbor = grid[ny * gridSize + nx];
        return !neighbor.filled;
      });

      if (isEdge && Math.random() < noiseLevel) {
        cell.filled = !cell.filled;
      }
    });

    // Step 4: 根据中心颜色参数决定是否翻转颜色
    if (centerColor === 'white') {
      grid.forEach(cell => cell.filled = !cell.filled);
    }

    // Draw grid
    svg.selectAll("rect")
      .data(grid)
      .enter()
      .append("rect")
      .attr("class", "cell")
      .attr("x", d => gridStartX + d.x * cellSize)
      .attr("y", d => gridStartY + d.y * cellSize)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("fill", d => d.filled ? "black" : "white")
      .attr("stroke", "#ccc")
      .attr("stroke-width", "0.5");
  }

  // Draw stimulus with current parameters
  drawStimulus("#stimulus");
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

// Function to initialize bar chart stimulus
function initBarChartStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', heights = [1, 1], crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置动画中心位置
  let lostViewCenterX, lostViewCenterY, goodViewCenterX, goodViewCenterY;
  const offset = 100;
  switch(position) {
    case 'upper':
      // 上位置：左柱在左视野，右柱在右视野
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 - offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 - offset;
      break;
    case 'lower':
      // 下位置：左柱在左视野，右柱在右视野
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 + offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 + offset;
      break;
    default:
      lostViewCenterX = width / 2 - offset;
      lostViewCenterY = height / 2 - offset;
      goodViewCenterX = width / 2 + offset;
      goodViewCenterY = height / 2 - offset;
  }
  
  
  // 使用传入的高度参数创建数据
  const data = [
    { color: "red", value: heights[0] * 30 }, // 将高度值转换为百分比
    { color: "blue", value: heights[1] * 30 }
  ];
  svg.selectAll("*").remove(); // Clear previous content

  // 柱状图的尺寸
  const barWidth = 30;
  const barHeight = 100;
  
  // 在丢失视野中心绘制第一个柱状图（红色）
  const lostViewBarX = lostViewCenterX - barWidth / 2;
  const lostViewBarY = lostViewCenterY - barHeight / 2;
  
  svg.append("rect")
    .attr("x", lostViewBarX)
    .attr("y", lostViewBarY + (barHeight - (data[0].value / 100) * barHeight))
    .attr("width", barWidth)
    .attr("height", (data[0].value / 100) * barHeight)
    .attr("fill", data[0].color);
  
  // 在良好视野中心绘制第二个柱状图（蓝色）
  const goodViewBarX = goodViewCenterX - barWidth / 2;
  const goodViewBarY = goodViewCenterY - barHeight / 2;
  
  svg.append("rect")
    .attr("x", goodViewBarX)
    .attr("y", goodViewBarY + (barHeight - (data[1].value / 100) * barHeight))
    .attr("width", barWidth)
    .attr("height", (data[1].value / 100) * barHeight)
    .attr("fill", data[1].color);
  // 绘制十字准线
  drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
}

const correctAudio = new Audio('/src/audio/correct.mp3');
const wrongAudio = new Audio('/src/audio/wrong.mp3');

timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: "Press continue to start the experiment.",
  choices: ['Continue'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn">${choice}</button></div>`
});

// var trial = {
// 	type: jsPsychVirtualChinrest,
// 	blindspot_reps: 3,
// 	resize_units: "cm",
// 	pixels_per_unit: 50
//   };
// timeline.push(trial);

// var resized_stimulus = {
// type: jsPsychHtmlButtonResponse,
// stimulus: `
// 	<p>If the measurements were done correctly, the square below should be 10 cm x 10 cm.</p>
// 	<div style="background-color: black; width: 500px; height: 500px; margin: 20px auto;"></div>
// `,
// choices: ['Continue']
// }
// timeline.push(resized_stimulus);

// var chinrest_trial = {
//     type: jsPsychHtmlButtonResponse,
//     stimulus: `
//         <img src="https://a.storyblok.com/f/149538/fa72811bba/tom_chinrest_side.PNG" alt="Chinrest" style="max-width:500px; display:block; margin: 0 auto 2rem auto;" />
//         <p>Alternatively we can use a physical chinrest to calibrate the distance between the eyes and the screen.</p>
//     `,
//     choices: ['Continue']
// };
// timeline.push(chinrest_trial);

// 使用函数来创建刺激，这样可以在运行时访问chinrest数据
const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
const signalDirections = [[0,1], [0,-1]]; // 四个不同的信号方向
const gratingDirections = ['left', 'right']; // grating的左右方向
// const gratingSpacings = [3, 5, 7]; // grating条纹间距：3, 5, 7
const barPositions = ['upper', 'lower']; // bar chart只有上下两个位置
const barHeights = [
  [1, 1], // 两个柱子高度相同
  [2, 2], 
  [3, 3], 
  [1, 2], // 左低右高
  [2, 3], 
  [1, 3]  // 最大差异
]; // 6种不同的高度组合
const gridCenterColors = ['black', 'white']; // 中心颜色：黑色或白色
const gridCenterPercentages = [25, 40]; // 中心网格百分比：25%或40%

// Motion trials - 四个位置，每个位置四个信号方向
for (const position of positions) {
  for (const signalDirection of signalDirections) {
	// console.log(signalDirection[1] > 0 ? 'Down' : 'Up');
    timeline.push({
      type: htmlKeyboardResponse,
      stimulus: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        return createMotionStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position).stimulus;
      },
      choices: "NO_KEYS",
      trial_duration: DURATION + CH_DURATION,
      on_load: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        // 只播放动画 DURATION 毫秒
        initMotionAnimation(
          sight_array, angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position, crosshairLength, crosshairStroke, DURATION
        );
        // DURATION 后移除动画元素，只保留十字
        setTimeout(() => {
          const svg = d3.select("#stimulus");
          svg.selectAll("circle").remove();
          svg.selectAll("g").remove();
          drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
        }, DURATION);
      }
    });

    timeline.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<p>What direction are the dots moving?</p>`,
      choices: ['Up⬆️', 'Down⬇️'],
      data: {
        correct_direction: signalDirection[1] > 0 ? 'Down' : 'Up'
      },
      button_html: (choice, i) => `<button class="jspsych-btn" id="feedback-btn-${i}">${choice}</button>`,
      on_load: function() {
        document.querySelectorAll('.jspsych-btn').forEach((btn, i) => {
          btn.addEventListener('click', function(e) {
            if (window._feedbackClicked) return;
            window._feedbackClicked = true;
            const userChoice = i === 0 ? 'Up' : 'Down';
            const correct = userChoice === jsPsych.getCurrentTrial().data.correct_direction;
            btn.style.backgroundColor = correct ? 'green' : 'red';
            btn.style.color = 'white';
            document.querySelectorAll('.jspsych-btn').forEach(b => b.disabled = true);

            // 播放音频反馈
            if (correct) {
              correctAudio.currentTime = 0;
              correctAudio.play();
            } else {
              wrongAudio.currentTime = 0;
              wrongAudio.play();
            }

            setTimeout(() => {
              window._feedbackClicked = false;
              jsPsych.finishTrial({correct: correct, userChoice: userChoice});
            }, ColorAnimationTime);
          });
        });
      },
      response_ends_trial: false
    });
  }
}

// Drifting grating trials - 四个位置，每个位置六个条件组合
for (const position of positions) {
  for (const direction of gratingDirections) {
    timeline.push({
      type: htmlKeyboardResponse,
      stimulus: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        return createDriftingGratingStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position).stimulus;
      },
      choices: "NO_KEYS",
      trial_duration: DURATION + CH_DURATION,
      on_load: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        initDriftingGratingAnimation(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, direction, 5, crosshairLength, crosshairStroke, DURATION);
        setTimeout(() => {
          const svg = d3.select("#stimulus");
          svg.selectAll("g").remove();
          svg.selectAll("clipPath").remove();
          svg.selectAll("circle").remove();
          drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
        }, DURATION);
      }
    });

    timeline.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<p>What direction are the stripes moving?</p>`,
      choices: ['Left', 'Right'],
      data: {
        correct_direction: direction === 'left' ? 'Left' : 'Right'
      },
      button_html: (choice, i) => `<button class="jspsych-btn" id="feedback-btn-${i}">${choice}</button>`,
      on_load: function() {
        document.querySelectorAll('.jspsych-btn').forEach((btn, i) => {
          btn.addEventListener('click', function(e) {
            if (window._feedbackClicked) return;
            window._feedbackClicked = true;
            const userChoice = i === 0 ? 'Left' : 'Right';
            const correct = userChoice === jsPsych.getCurrentTrial().data.correct_direction;
            btn.style.backgroundColor = correct ? 'green' : 'red';
            btn.style.color = 'white';
            document.querySelectorAll('.jspsych-btn').forEach(b => b.disabled = true);

            // 播放音频反馈
            if (correct) {
              correctAudio.currentTime = 0;
              correctAudio.play();
            } else {
              wrongAudio.currentTime = 0;
              wrongAudio.play();
            }

            setTimeout(() => {
              window._feedbackClicked = false;
              jsPsych.finishTrial({correct: correct, userChoice: userChoice});
            }, ColorAnimationTime);
          });
        });
      },
      response_ends_trial: false
    });
  }
}

// Grid trials - 四个位置，每个位置四种条件组合
for (const position of positions) {
  for (const centerColor of gridCenterColors) {
    for (const centerPercentage of gridCenterPercentages) {
      timeline.push({
        type: htmlKeyboardResponse,
        stimulus: function() {
          const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
          return createGridStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, centerPercentage).stimulus;
        },
        choices: "NO_KEYS",
        trial_duration: DURATION + CH_DURATION,
        on_load: function() {
          const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
          initGridStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, centerPercentage, crosshairLength, crosshairStroke, DURATION);
          setTimeout(() => {
            const svg = d3.select("#stimulus");
            svg.selectAll("rect").remove();
            drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
          }, DURATION);
        }
      });

      timeline.push({
        type: jsPsychHtmlButtonResponse,
        stimulus: `<p>Are there more black cells or white cells?</p>`,
        choices: ['Black', 'White'],
        data: {
          correct_direction: (centerColor === 'black' && centerPercentage > 50) || (centerColor === 'white' && centerPercentage < 50) ? 'Black' : 'White'
        },
        button_html: (choice, i) => `<button class="jspsych-btn" id="feedback-btn-${i}">${choice}</button>`,
        on_load: function() {
          document.querySelectorAll('.jspsych-btn').forEach((btn, i) => {
            btn.addEventListener('click', function(e) {
              if (window._feedbackClicked) return;
              window._feedbackClicked = true;
              const userChoice = i === 0 ? 'Black' : 'White';
              const correct = userChoice === jsPsych.getCurrentTrial().data.correct_direction;
              btn.style.backgroundColor = correct ? 'green' : 'red';
              btn.style.color = 'white';
              document.querySelectorAll('.jspsych-btn').forEach(b => b.disabled = true);

              // 播放音频反馈
              if (correct) {
                correctAudio.currentTime = 0;
                correctAudio.play();
              } else {
                wrongAudio.currentTime = 0;
                wrongAudio.play();
              }

              setTimeout(() => {
                window._feedbackClicked = false;
                jsPsych.finishTrial({correct: correct, userChoice: userChoice});
              }, ColorAnimationTime);
            });
          });
        },
        response_ends_trial: false
      });
    }
  }
}

// Bar chart trials - 两个位置，每个位置六种高度组合
for (const position of barPositions) {
  for (const heights of barHeights) {
    timeline.push({
      type: htmlKeyboardResponse,
      stimulus: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        return createBarChartStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, heights).stimulus;
      },
      choices: "NO_KEYS",
      trial_duration: DURATION + CH_DURATION,
      on_load: function() {
        const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
        initBarChartStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, heights, crosshairLength, crosshairStroke, DURATION);
        setTimeout(() => {
          const svg = d3.select("#stimulus");
          svg.selectAll("rect").remove();
          drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
        }, DURATION);
      }
    });

    timeline.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<p>The height of the bars are</p>`,
      choices: ['Same', 'Different'],
      data: {
        correct_direction: heights[0] === heights[1] ? 'Same' : 'Different'
      },
      button_html: (choice, i) => `<button class="jspsych-btn" id="feedback-btn-${i}">${choice}</button>`,
      on_load: function() {
        document.querySelectorAll('.jspsych-btn').forEach((btn, i) => {
          btn.addEventListener('click', function(e) {
            if (window._feedbackClicked) return;
            window._feedbackClicked = true;
            const userChoice = i === 0 ? 'Same' : 'Different';
            const correct = userChoice === jsPsych.getCurrentTrial().data.correct_direction;
            btn.style.backgroundColor = correct ? 'green' : 'red';
            btn.style.color = 'white';
            document.querySelectorAll('.jspsych-btn').forEach(b => b.disabled = true);

            // 播放音频反馈
            if (correct) {
              correctAudio.currentTime = 0;
              correctAudio.play();
            } else {
              wrongAudio.currentTime = 0;
              wrongAudio.play();
            }

            setTimeout(() => {
              window._feedbackClicked = false;
              jsPsych.finishTrial({correct: correct, userChoice: userChoice});
            }, ColorAnimationTime);
          });
        });
      },
      response_ends_trial: false
    });
  }
}

timeline.push({
  type: htmlKeyboardResponse,
  stimulus: "The experiment is over! Thank you for your participation.",
  choices: ['Quit']
});

jsPsych.run(timeline);