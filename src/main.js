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

// const ColorAnimationTime = 500;
// Individual crosshair stage durations
const DURATION = 200; // 动画时长
const PRE_STIMULUS_CH_DURATION = 1000;  // Part 1: Initial crosshair before stimulus
const POST_STIMULUS_CH_DURATION = 500; // Part 3: Crosshair after stimulus  
const FEEDBACK_CH_DURATION = 1000;      // Final: Colored feedback crosshair

// deg2Pixel function: Convert visual angles to pixel offsets
function deg2Pixel(angleDeg, chinrestData = null, fallbackParams = {}) {
    if (chinrestData && chinrestData.px2deg) {
        // Use direct pixels-per-degree conversion from chinrest calibration
		console.log(`Using chinrest data px2deg: ${chinrestData.px2deg}`);
        return angleDeg * chinrestData.px2deg * 2; //deg of px2deg is double sided degree, angleDeg is one sided degree
    } else {
        // Fall back to manual calculation with provided or default parameters
		console.warn(`Using fallback parameters`);
        const viewingDistanceCm = fallbackParams.viewingDistanceCm || 80;
        const screenSizeCm = fallbackParams.screenSizeCm || [71, 51];
        const resolution = fallbackParams.resolution || [3840, 2160];
        
        // Original calculation method
        const physicalOffsetCm = viewingDistanceCm * Math.tan(angleDeg * Math.PI / 180);
        const pixelsPerCmX = resolution[0] / screenSizeCm[0];
        const pixelsPerCmY = resolution[1] / screenSizeCm[1];
        const pixelsPerCm = (pixelsPerCmX + pixelsPerCmY) / 2;
        
        return physicalOffsetCm * pixelsPerCm;
    }
}

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

// // Function to create drifting grating stimulus
// function createDriftingGratingStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper') {
//   return {
//     type: htmlKeyboardResponse,
//     stimulus: `
// 	<style>
// 		body {
// 			font-family: Arial, sans-serif;
// 			margin: 0;
// 			padding: 0;
// 			background-color: #ccc;
// 			overflow: hidden;
// 		}
// 	</style>
	
// 	<svg id="stimulus" width="100%" height="100%"></svg>

//     `,
//     choices: "NO_KEYS",  // No key press allowed to skip
//     trial_duration: DURATION, // Duration 5 seconds
//     on_load: function() {
//       // Initialize drifting grating animation
//       initDriftingGratingAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData, position);
//     }
//   };
// }

// Function to create static grating stimulus
function createGratingStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper') {
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
    trial_duration: DURATION, // Duration for static display
    on_load: function() {
      // Initialize static grating display
      initGratingStimulus(sight_array, angleArray,screenWidth,screenHeight, chinrestData, position);
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
function drawCrosshair(svg, width, height, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke, color = 'black') {
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
    .attr('stroke', color)
    .attr('stroke-width', crosshairStrokeWidth);
  // 垂直线
  svg.append('line')
    .attr('class', 'crosshair')
    .attr('x1', centerX)
    .attr('y1', centerY - crosshairLen / 2)
    .attr('x2', centerX)
    .attr('y2', centerY + crosshairLen / 2)
    .attr('stroke', color)
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
	const offset = deg2Pixel(2, chinrestData); // 2 degree visual angle offset
	
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
// function initDriftingGratingAnimation(sight_array, angleArray,screenWidth,screenHeight, chinrestData = null, position = 'left_upper', direction = 'left', spacing = 5, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
//   const svg = d3.select("#stimulus");
  
//   // 获取实际的SVG尺寸
//   const width = screenWidth;
//   const height = screenHeight;
  
//   // 设置SVG的viewBox以确保正确的缩放
//   svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
//   // 根据位置参数设置动画中心位置
//   let animationCenterX, animationCenterY;
//   const offset = 100;
  
//   switch(position) {
//     case 'left_upper':
//       animationCenterX = width / 2 - offset;
//       animationCenterY = height / 2 - offset;
//       break;
//     case 'left_lower':
//       animationCenterX = width / 2 - offset;
//       animationCenterY = height / 2 + offset;
//       break;
//     case 'right_upper':
//       animationCenterX = width / 2 + offset;
//       animationCenterY = height / 2 - offset;
//       break;
//     case 'right_lower':
//       animationCenterX = width / 2 + offset;
//       animationCenterY = height / 2 + offset;
//       break;
//     default:
//       animationCenterX = width / 2 + offset;
//       animationCenterY = height / 2 + offset;
//   }

//   function createDriftingGrating(containerId, direction = "left", driftHz = 10, spacing = 5) {
//     const radius = 80;
//     const stripeWidth = 3; // 固定条纹宽度为3

//     // Define circular clip mask
//     svg.append("clipPath")
//       .attr("id", `clip-${containerId}`)
//       .append("circle")
//       .attr("cx", animationCenterX)
//       .attr("cy", animationCenterY)
//       .attr("r", radius);

//     // Group for stripes (clipped)
//     const g = svg.append("g")
//       .attr("clip-path", `url(#clip-${containerId})`);

//     // Add vertical stripes with specified spacing
//     const totalWidth = stripeWidth + spacing; // 条纹宽度 + 间距
//     const numStripes = Math.ceil(width / totalWidth);
//     for (let i = -numStripes; i < numStripes * 2; i++) {
//       g.append("rect")
//         .attr("x", i * totalWidth)
//         .attr("y", 0)
//         .attr("width", stripeWidth)
//         .attr("height", height)
//         .attr("fill", "#fff");
//     }

//     // Circle outline
//     svg.append("circle")
//       .attr("cx", animationCenterX)
//       .attr("cy", animationCenterY)
//       .attr("r", radius)
//       .attr("fill", "none")
//       .attr("stroke", "black")
//       .attr("stroke-width", "0");

//     // Animation
//     let phase = 0;
//     const fps = 60;
//     const pixelsPerSecond = driftHz * totalWidth; // 使用总宽度（条纹+间距）

//     function animate() {
//       phase += (direction === "left" ? -1 : 1) * (pixelsPerSecond / fps);
//       g.attr("transform", `translate(${phase % totalWidth}, 0)`);
//       requestAnimationFrame(animate);
//     }

//     animate();
//   }

//   createDriftingGrating("stimulus", direction, 10, spacing);   // 10Hz with specified direction and spacing
//   // 绘制十字准线
//   drawCrosshair(svg, width, height, crosshairLen, crosshairStrokeWidth);
// }

// Function to initialize static grating stimulus
function initGratingStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData = null, position = 'left_upper', orientation = 'vertical', spacing = 5, crosshairLen = crosshairLength, crosshairStrokeWidth = crosshairStroke) {
  const svg = d3.select("#stimulus");
  
  // 获取实际的SVG尺寸
  const width = screenWidth;
  const height = screenHeight;
  
  // 设置SVG的viewBox以确保正确的缩放
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  
  // 根据位置参数设置刺激中心位置
  let stimulusCenterX, stimulusCenterY;
  const offset = deg2Pixel(2, chinrestData); // 2 degree visual angle offset
  
  switch(position) {
    case 'left_upper':
      stimulusCenterX = width / 2 - offset;
      stimulusCenterY = height / 2 - offset;
      break;
    case 'left_lower':
      stimulusCenterX = width / 2 - offset;
      stimulusCenterY = height / 2 + offset;
      break;
    case 'right_upper':
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 - offset;
      break;
    case 'right_lower':
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 + offset;
      break;
    default:
      stimulusCenterX = width / 2 + offset;
      stimulusCenterY = height / 2 + offset;
  }

  function createStaticGrating(containerId, orientation = "vertical", spacing = 5) {
    const radius = 80;
    const stripeWidth = 3; // 固定条纹宽度为3

    // Define circular clip mask
    svg.append("clipPath")
      .attr("id", `clip-${containerId}`)
      .append("circle")
      .attr("cx", stimulusCenterX)
      .attr("cy", stimulusCenterY)
      .attr("r", radius);

    // Group for stripes (clipped)
    const g = svg.append("g")
      .attr("clip-path", `url(#clip-${containerId})`);

    const totalWidth = stripeWidth + spacing; // 条纹宽度 + 间距
    
    if (orientation === "vertical") {
      // Add vertical stripes
      const numStripes = Math.ceil(width / totalWidth);
      for (let i = -numStripes; i < numStripes * 2; i++) {
        g.append("rect")
          .attr("x", i * totalWidth)
          .attr("y", 0)
          .attr("width", stripeWidth)
          .attr("height", height)
          .attr("fill", "#fff");
      }
    } else if (orientation === "horizontal") {
      // Add horizontal stripes
      const numStripes = Math.ceil(height / totalWidth);
      for (let i = -numStripes; i < numStripes * 2; i++) {
        g.append("rect")
          .attr("x", 0)
          .attr("y", i * totalWidth)
          .attr("width", width)
          .attr("height", stripeWidth)
          .attr("fill", "#fff");
      }
    }

    // Circle outline
    svg.append("circle")
      .attr("cx", stimulusCenterX)
      .attr("cy", stimulusCenterY)
      .attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", "0");
  }

  createStaticGrating("stimulus", orientation, spacing);
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
  const offset = deg2Pixel(2, chinrestData); // 2 degree visual angle offset
  
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
  const offset = deg2Pixel(2, chinrestData); // 2 degree visual angle offset
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
    { color: "black", value: heights[0] * 30 }, // 将高度值转换为百分比
    { color: "black", value: heights[1] * 30 }
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

// Utility function to shuffle an array
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Function to create a 30-second break trial with countdown
function createBreakTrial() {
  return {
    type: htmlKeyboardResponse,
    stimulus: function() {
      return `
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ccc;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          .break-container {
            text-align: center;
            color: black;
          }
          .break-title {
            font-size: 24px;
            margin-bottom: 20px;
          }
          .countdown {
            font-size: 48px;
            font-weight: bold;
            margin: 20px 0;
          }
          .break-instruction {
            font-size: 18px;
            margin-top: 20px;
          }
        </style>
        <div class="break-container">
          <div class="break-title">Take a Break</div>
          <div class="countdown" id="countdown">30</div>
          <div class="break-instruction">The next block will start automatically in <span id="seconds">30</span> seconds.</div>
        </div>
      `;
    },
    choices: "NO_KEYS",
    trial_duration: 30000, // 30 seconds
    on_load: function() {
      let timeLeft = 30;
      const countdownElement = document.getElementById('countdown');
      const secondsElement = document.getElementById('seconds');
      
      const timer = setInterval(() => {
        timeLeft--;
        if (countdownElement) countdownElement.textContent = timeLeft;
        if (secondsElement) secondsElement.textContent = timeLeft;
        
        if (timeLeft <= 0) {
          clearInterval(timer);
        }
      }, 1000);
    }
  };
}

// Generate base trial combinations for each stimulus type
function generateMotionTrialCombinations() {
  const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
  const signalDirections = [[0,1], [0,-1]];
  const combinations = [];
  
  for (const position of positions) {
    for (const signalDirection of signalDirections) {
      combinations.push({ position, signalDirection });
    }
  }
  return combinations; // 8 combinations
}

function generateGratingTrialCombinations() {
  const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
  const orientations = ['vertical', 'horizontal'];
  const combinations = [];
  
  for (const position of positions) {
    for (const orientation of orientations) {
      combinations.push({ position, orientation });
    }
  }
  return combinations; // 8 combinations
}

function generateGridTrialCombinations() {
  const positions = ['left_upper', 'left_lower', 'right_upper', 'right_lower'];
  const centerColors = ['black', 'white'];
  const centerPercentages = [15, 30];
  const combinations = [];
  
  for (const position of positions) {
    for (const centerColor of centerColors) {
      for (const centerPercentage of centerPercentages) {
        combinations.push({ position, centerColor, centerPercentage });
      }
    }
  }
  return combinations; // 16 combinations
}

function generateBarChartTrialCombinations() {
  const positions = ['upper', 'lower'];
  const barHeights = [
    [1, 1], [2, 2], [3, 3], 
    [1, 2], [2, 3], [1, 3]
  ];
  const combinations = [];
  
  for (const position of positions) {
    for (const heights of barHeights) {
      combinations.push({ position, heights });
    }
  }
  return combinations; // 12 combinations
}

// Function to generate a single trial sequence for motion stimulus
function generateMotionTrialSequence(combination) {
  const { position, signalDirection } = combination;
  const trialSequence = [];
  
  // Part 1: Pre-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Part 2: Motion stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      return createMotionStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position).stimulus;
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      initMotionAnimation(
        sight_array, angleArray, screenWidth, screenHeight, chinrestData, signalDirection, position, crosshairLength, crosshairStroke
      );
    }
  });
  
  // Part 3: Post-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Part 4: Response trial
  trialSequence.push({
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
        .question-text {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 18px;
          z-index: 10;
        }
        .instruction-text {
          position: absolute;
          top: 60%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 16px;
          z-index: 10;
        }
        .keycap {
          display: inline-block;
          background: #f0f0f0;
          border: 2px solid #ccc;
          border-radius: 4px;
          padding: 4px 8px;
          margin: 0 2px;
          font-family: monospace;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          background: linear-gradient(145deg, #ffffff, #e6e6e6);
        }
      </style>
      <div class="question-text">What direction are the dots moving?</div>
      <div class="instruction-text">Press <span class="keycap">F</span> for Up ⬆️, <span class="keycap">J</span> for Down ⬇️</div>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: ['F', 'J'],
    data: {
      correct_direction: signalDirection[1] > 0 ? 'Down' : 'Up'
    },
    on_start: function(trial) {
      console.log(`Motion trial - Position: ${position}, Signal: [${signalDirection[0]},${signalDirection[1]}] - Correct answer: ${trial.data.correct_direction} (Press ${trial.data.correct_direction === 'Up' ? 'F' : 'J'})`);
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      const userChoice = data.response.toLowerCase() === 'f' ? 'Up' : 'Down';
      const correct = userChoice === data.correct_direction;
      
      console.log(`Motion trial result - User pressed: ${data.response}, User choice: ${userChoice}, Correct answer: ${data.correct_direction}, Match: ${correct}`);
      
      if (correct) {
        correctAudio.currentTime = 0;
        correctAudio.play();
      } else {
        wrongAudio.currentTime = 0;
        wrongAudio.play();
      }
      
      data.correct = correct;
      data.userChoice = userChoice;
    }
  });
  
  // Part 5: Feedback crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

// Function to generate similar trial sequences for other stimulus types
function generateGratingTrialSequence(combination) {
  const { position, orientation } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Grating stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      return createGratingStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position).stimulus;
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      initGratingStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, orientation, 5, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
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
        .question-text {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 18px;
          z-index: 10;
        }
        .instruction-text {
          position: absolute;
          top: 60%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 16px;
          z-index: 10;
        }
        .keycap {
          display: inline-block;
          background: #f0f0f0;
          border: 2px solid #ccc;
          border-radius: 4px;
          padding: 4px 8px;
          margin: 0 2px;
          font-family: monospace;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          background: linear-gradient(145deg, #ffffff, #e6e6e6);
        }
      </style>
      <div class="question-text">What orientation are the stripes?</div>
      <div class="instruction-text">Press <span class="keycap">F</span> for Vertical ↕️, <span class="keycap">J</span> for Horizontal ↔️</div>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: ['F', 'J'],
    data: {
      correct_direction: orientation === 'vertical' ? 'Vertical' : 'Horizontal'
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      const userChoice = data.response.toLowerCase() === 'f' ? 'Vertical' : 'Horizontal';
      const correct = userChoice === data.correct_direction;
      
      if (correct) {
        correctAudio.currentTime = 0;
        correctAudio.play();
      } else {
        wrongAudio.currentTime = 0;
        wrongAudio.play();
      }
      
      data.correct = correct;
      data.userChoice = userChoice;
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

function generateGridTrialSequence(combination) {
  const { position, centerColor, centerPercentage } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Grid stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      return createGridStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, centerPercentage).stimulus;
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      initGridStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, centerPercentage, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
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
        .question-text {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 18px;
          z-index: 10;
        }
        .instruction-text {
          position: absolute;
          top: 60%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 16px;
          z-index: 10;
        }
        .keycap {
          display: inline-block;
          background: #f0f0f0;
          border: 2px solid #ccc;
          border-radius: 4px;
          padding: 4px 8px;
          margin: 0 2px;
          font-family: monospace;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          background: linear-gradient(145deg, #ffffff, #e6e6e6);
        }
      </style>
      <div class="question-text">Are there more black cells or white cells?</div>
      <div class="instruction-text">Press <span class="keycap">F</span> for Black ⬛, <span class="keycap">J</span> for White ⬜</div>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: ['F', 'J'],
    data: {
      correct_direction: (centerColor === 'black' && centerPercentage > 50) || (centerColor === 'white' && centerPercentage < 50) ? 'Black' : 'White'
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      const userChoice = data.response.toLowerCase() === 'f' ? 'Black' : 'White';
      const correct = userChoice === data.correct_direction;
      
      if (correct) {
        correctAudio.currentTime = 0;
        correctAudio.play();
      } else {
        wrongAudio.currentTime = 0;
        wrongAudio.play();
      }
      
      data.correct = correct;
      data.userChoice = userChoice;
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

function generateBarChartTrialSequence(combination) {
  const { position, heights } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: PRE_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });
  
  // Bar chart stimulus
  trialSequence.push({
    type: htmlKeyboardResponse,
    stimulus: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      return createBarChartStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, heights).stimulus;
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      const chinrestData = jsPsych.data.get().filter({trial_type: 'virtual-chinrest'}).last(1).values()[0];
      initBarChartStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, heights, crosshairLength, crosshairStroke);
    }
  });
  
  // Post-stimulus crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: POST_STIMULUS_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    }
  });

  // Response trial
  trialSequence.push({
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
        .question-text {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 18px;
          z-index: 10;
        }
        .instruction-text {
          position: absolute;
          top: 60%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: black;
          font-size: 16px;
          z-index: 10;
        }
        .keycap {
          display: inline-block;
          background: #f0f0f0;
          border: 2px solid #ccc;
          border-radius: 4px;
          padding: 4px 8px;
          margin: 0 2px;
          font-family: monospace;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          background: linear-gradient(145deg, #ffffff, #e6e6e6);
        }
      </style>
      <div class="question-text">The height of the bars are</div>
      <div class="instruction-text">Press <span class="keycap">F</span> for Same ≡, <span class="keycap">J</span> for Different ≠</div>
      <svg id="stimulus" width="100%" height="100%"></svg>
    `,
    choices: ['F', 'J'],
    data: {
      correct_direction: heights[0] === heights[1] ? 'Same' : 'Different'
    },
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke);
    },
    on_finish: function(data) {
      const userChoice = data.response.toLowerCase() === 'f' ? 'Same' : 'Different';
      const correct = userChoice === data.correct_direction;
      
      if (correct) {
        correctAudio.currentTime = 0;
        correctAudio.play();
      } else {
        wrongAudio.currentTime = 0;
        wrongAudio.play();
      }
      
      data.correct = correct;
      data.userChoice = userChoice;
    }
  });
  
  // Feedback crosshair
  trialSequence.push({
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
    choices: "NO_KEYS",
    trial_duration: FEEDBACK_CH_DURATION,
    on_load: function() {
      const svg = d3.select("#stimulus");
      svg.attr("width", screenWidth).attr("height", screenHeight).attr("viewBox", `0 0 ${screenWidth} ${screenHeight}`);
      
      const previousTrial = jsPsych.data.get().last(1).values()[0];
      const crosshairColor = previousTrial.correct ? 'green' : 'red';
      
      drawCrosshair(svg, screenWidth, screenHeight, crosshairLength, crosshairStroke, crosshairColor);
    }
  });
  
  return trialSequence;
}

timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: "Press continue to start the experiment.",
  choices: ['Continue'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn">${choice}</button></div>`
});

var chinrestTrial = {
	type: jsPsychVirtualChinrest,
	blindspot_reps: 3,
	resize_units: "none"
};
timeline.push(chinrestTrial);

// Clinic version uses the combination generation functions below

// CLINIC VERSION - Randomized blocks with breaks for each stimulus type

// === MOTION TRIALS ===
// 8 base trials × 12 blocks = 96 trials
// Break after every 3 blocks (24 trials)
const motionCombinations = generateMotionTrialCombinations();
for (let block = 1; block <= 12; block++) {
  // Add break after every 3 blocks (except the first block)
  if (block > 1 && (block - 1) % 3 === 0) {
    timeline.push(createBreakTrial());
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(motionCombinations);
  for (const combination of randomizedBlock) {
    const trialSequence = generateMotionTrialSequence(combination);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// Break between Motion and Grating trials
timeline.push(createBreakTrial());

// === GRATING TRIALS ===
// 8 base trials × 12 blocks = 96 trials  
// Break after every 3 blocks (24 trials)
const gratingCombinations = generateGratingTrialCombinations();
for (let block = 1; block <= 12; block++) {
  // Add break after every 3 blocks (except the first block)
  if (block > 1 && (block - 1) % 3 === 0) {
    timeline.push(createBreakTrial());
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(gratingCombinations);
  for (const combination of randomizedBlock) {
    const trialSequence = generateGratingTrialSequence(combination);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// Break between Grating and Grid trials
timeline.push(createBreakTrial());

// === GRID TRIALS ===
// 16 base trials × 6 blocks = 96 trials
// Break after every 2 blocks (32 trials)
const gridCombinations = generateGridTrialCombinations();
for (let block = 1; block <= 6; block++) {
  // Add break after every 2 blocks (except the first block)
  if (block > 1 && (block - 1) % 2 === 0) {
    timeline.push(createBreakTrial());
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(gridCombinations);
  for (const combination of randomizedBlock) {
    const trialSequence = generateGridTrialSequence(combination);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// Break between Grid and Bar Chart trials
timeline.push(createBreakTrial());

// === BAR CHART TRIALS ===
// 12 base trials × 8 blocks = 96 trials
// Break after every 2 blocks (24 trials)
const barChartCombinations = generateBarChartTrialCombinations();
for (let block = 1; block <= 8; block++) {
  // Add break after every 2 blocks (except the first block)
  if (block > 1 && (block - 1) % 2 === 0) {
    timeline.push(createBreakTrial());
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(barChartCombinations);
  for (const combination of randomizedBlock) {
    const trialSequence = generateBarChartTrialSequence(combination);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

timeline.push({
  type: htmlKeyboardResponse,
  stimulus: "The experiment is over! Thank you for your participation.",
  choices: ['Quit']
});

jsPsych.run(timeline);