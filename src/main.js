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

// Task progress tracking
const SHOW_TASK_PROGRESS = true; // Global flag to enable/disable task progress display

// deg2Pixel function: Convert visual angles to pixel offsets using calculator data
function deg2Pixel(angleDeg, chinrestData = null, fallbackParams = {}) {
    // Try to get calculator data from jsPsych first
    const allData = jsPsych.data.get();
    const calculatorData = allData.values().find(trial => trial.calculator_data)?.calculator_data;
    
    if (calculatorData) {
        // Use calculator data for precise conversion
        console.log(`Using calculator data - pixels per degree: ${calculatorData.pixelsPerDegree}`);
        return angleDeg * calculatorData.pixelsPerDegree;
    } else if (chinrestData && chinrestData.px2deg) {
        // Fallback to chinrest data if available (commented out but kept for reference)
        console.log(`Using chinrest data px2deg: ${chinrestData.px2deg}`);
        return angleDeg * chinrestData.px2deg * 2; //deg of px2deg is double sided degree, angleDeg is one sided degree
    } else {
        // Final fallback to manual calculation with provided or default parameters
        console.warn(`Using fallback parameters - consider running the visual angle calculator`);
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
	const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
	
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
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
  
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
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
  
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
  const offset = deg2Pixel(5, chinrestData); // 5 degree visual angle offset
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

const correctAudio = new Audio('/audio/correct.mp3');
const wrongAudio = new Audio('/audio/wrong.mp3');

// Function to save data to server
function saveDataToServer(filename, csvData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'save_data.php', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        console.log('XHR Response Status:', xhr.status);
        console.log('XHR Response Text:', xhr.responseText);
        
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || 'Server save failed'));
            }
          } catch (e) {
            console.error('JSON Parse Error:', e);
            console.error('Raw Response:', xhr.responseText);
            reject(new Error(`Invalid server response: ${xhr.responseText.substring(0, 100)}`));
          }
        } else {
          reject(new Error(`Server error: ${xhr.status} - ${xhr.responseText}`));
        }
      }
    };
    
    xhr.onerror = function() {
      reject(new Error('Network error'));
    };
    
    const postData = {
      filename: filename,
      filedata: csvData
    };
    
    xhr.send(JSON.stringify(postData));
  });
}

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
// function createBreakTrial() {
//   return {
//     type: htmlKeyboardResponse,
//     stimulus: function() {
//       return `
//         <style>
//           body {
//             font-family: Arial, sans-serif;
//             margin: 0;
//             padding: 0;
//             background-color: #ccc;
//             overflow: hidden;
//             display: flex;
//             justify-content: center;
//             align-items: center;
//             height: 100vh;
//           }
//           .break-container {
//             text-align: center;
//             color: black;
//           }
//           .break-title {
//             font-size: 24px;
//             margin-bottom: 20px;
//           }
//           .countdown {
//             font-size: 48px;
//             font-weight: bold;
//             margin: 20px 0;
//           }
//           .break-instruction {
//             font-size: 18px;
//             margin-top: 20px;
//           }
//         </style>
//         <div class="break-container">
//           <div class="break-title">Take a Break</div>
//           <div class="countdown" id="countdown">30</div>
//           <div class="break-instruction">The next block will start automatically in <span id="seconds">30</span> seconds.</div>
//         </div>
//       `;
//     },
//     choices: "NO_KEYS",
//     trial_duration: 30000, // 30 seconds
//     on_load: function() {
//       let timeLeft = 30;
//       const countdownElement = document.getElementById('countdown');
//       const secondsElement = document.getElementById('seconds');
      
//       const timer = setInterval(() => {
//         timeLeft--;
//         if (countdownElement) countdownElement.textContent = timeLeft;
//         if (secondsElement) secondsElement.textContent = timeLeft;
        
//         if (timeLeft <= 0) {
//           clearInterval(timer);
//         }
//       }, 1000);
//     }
//   };
// }

// Function to create a ready screen with countdown and spacebar continue
function createReadyScreen(taskName = "next task") {
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
          .ready-container {
            text-align: center;
            color: black;
          }
          .ready-title {
            font-size: 32px;
            margin-bottom: 20px;
            font-weight: bold;
          }
          .task-info {
            font-size: 20px;
            margin-bottom: 30px;
            color: #444;
          }
          .countdown {
            font-size: 48px;
            font-weight: bold;
            margin: 20px 0;
            color: #333;
          }
          .start-instruction {
            font-size: 18px;
            margin-bottom: 20px;
          }
          .spacebar-key {
            display: inline-block;
            background: #f0f0f0;
            border: 2px solid #ccc;
            border-radius: 4px;
            padding: 8px 20px;
            margin: 0 4px;
            font-family: monospace;
            font-weight: bold;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            background: linear-gradient(145deg, #ffffff, #e6e6e6);
          }
        </style>
        <div class="ready-container">
          <div class="ready-title">Ready to Start?</div>
          <div class="task-info">About to begin: ${taskName}</div>
          <div class="countdown" id="countdown">30</div>
          <div class="start-instruction">Press <span class="spacebar-key">SPACE</span> when you're ready to continue.</div>
        </div>
      `;
    },
    choices: [' '],
    trial_duration: null,
    on_load: function() {
      let timeLeft = 30;
      const countdownElement = document.getElementById('countdown');
      
      const timer = setInterval(() => {
        timeLeft--;
        if (countdownElement) {
          countdownElement.textContent = timeLeft;
        }
        
        // Stop the timer when it reaches 0, but don't advance the trial
        if (timeLeft <= 0) {
          clearInterval(timer);
          if (countdownElement) {
            countdownElement.textContent = '0';
          }
        }
      }, 1000);
    }
  };
}

// Helper function to create progress overlay HTML
function createProgressOverlay(taskType, trialNum, totalTrials) {
  if (!SHOW_TASK_PROGRESS) return '';
  
  return `
    <div id="progress-overlay" style="
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 14px;
      font-family: Arial, sans-serif;
      z-index: 1000;
    ">
      Task: ${taskType} | Trial ${trialNum} of ${totalTrials}
    </div>
  `;
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
function generateMotionTrialSequence(combination, taskType = 'Motion', trialNum = 1, totalTrials = 1) {
  const { position, signalDirection } = combination;
  const trialSequence = [];
  
  // Part 1: Pre-stimulus crosshair
  trialSequence.push({
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
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
      return createMotionStimulus(sight_array, angleArray, screenWidth, screenHeight, null, signalDirection, position).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
    },
    choices: "NO_KEYS",
    trial_duration: DURATION,
    on_load: function() {
      initMotionAnimation(
        sight_array, angleArray, screenWidth, screenHeight, null, signalDirection, position, crosshairLength, crosshairStroke
      );
    }
  });
  
  // Part 3: Post-stimulus crosshair
  trialSequence.push({
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
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: ['F', 'J'],
    data: {
      correct_direction: signalDirection[1] > 0 ? 'Down' : 'Up',
      task_type: 'Motion'
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
function generateGratingTrialSequence(combination, taskType = 'Orientation', trialNum = 1, totalTrials = 1) {
  const { position, orientation } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
      return createGratingStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: ['F', 'J'],
    data: {
      correct_direction: orientation === 'vertical' ? 'Vertical' : 'Horizontal',
      task_type: 'Orientation'
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

function generateGridTrialSequence(combination, taskType = 'Centrality', trialNum = 1, totalTrials = 1) {
  const { position, centerColor, centerPercentage } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
      return createGridStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, centerColor, centerPercentage).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: ['F', 'J'],
    data: {
      correct_direction: (centerColor === 'black' && centerPercentage > 50) || (centerColor === 'white' && centerPercentage < 50) ? 'Black' : 'White',
      task_type: 'Centrality'
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

function generateBarChartTrialSequence(combination, taskType = 'Bar', trialNum = 1, totalTrials = 1) {
  const { position, heights } = combination;
  const trialSequence = [];
  
  // Pre-stimulus crosshair
  trialSequence.push({
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
          }
        </style>
        <svg id="stimulus" width="100%" height="100%"></svg>
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
      return createBarChartStimulus(sight_array, angleArray, screenWidth, screenHeight, chinrestData, position, heights).stimulus + createProgressOverlay(taskType, trialNum, totalTrials);
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
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
    stimulus: function() {
      return `
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
        ${createProgressOverlay(taskType, trialNum, totalTrials)}
      `;
    },
    choices: ['F', 'J'],
    data: {
      correct_direction: heights[0] === heights[1] ? 'Same' : 'Different',
      task_type: 'Bar'
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

// User ID input trial
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `
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
      .user-id-container {
        text-align: center;
        color: black;
        background: white;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      .user-id-title {
        font-size: 24px;
        margin-bottom: 20px;
      }
      .user-id-input {
        font-size: 18px;
        padding: 10px;
        margin: 10px;
        border: 2px solid #ccc;
        border-radius: 5px;
        width: 200px;
        text-align: center;
      }
      .user-id-instruction {
        font-size: 16px;
        margin: 15px 0;
        color: #666;
      }
      .error-message {
        color: red;
        font-size: 14px;
        margin-top: 10px;
        display: none;
      }
    </style>
    <div class="user-id-container">
      <div class="user-id-title">Enter Your User ID</div>
      <div class="user-id-instruction">Please enter your participant ID (numbers only)</div>
      <input type="text" id="user-id-input" class="user-id-input" placeholder="e.g., 123" maxlength="10">
      <div id="error-message" class="error-message">Please enter a valid ID (numbers only)</div>
    </div>
  `,
  choices: ['Continue'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn" id="continue-btn">${choice}</button></div>`,
  on_load: function() {
    const continueBtn = document.getElementById('continue-btn');
    const userIdInput = document.getElementById('user-id-input');
    const errorMessage = document.getElementById('error-message');
    
    // Disable continue button initially
    continueBtn.disabled = true;
    continueBtn.style.opacity = '0.5';
    
    // Store user ID value in a variable that persists
    let currentUserId = '';
    
    // Validate input on each keystroke
    userIdInput.addEventListener('input', function() {
      const value = this.value.trim();
      const isValid = /^\d+$/.test(value) && value.length > 0;
      currentUserId = value; // Store the current value
      
      if (isValid) {
        errorMessage.style.display = 'none';
        continueBtn.disabled = false;
        continueBtn.style.opacity = '1';
      } else {
        if (value.length > 0) {
          errorMessage.style.display = 'block';
        }
        continueBtn.disabled = true;
        continueBtn.style.opacity = '0.5';
      }
    });
    
    // Store the user ID when continue button is clicked
    continueBtn.addEventListener('click', function() {
      if (currentUserId && /^\d+$/.test(currentUserId)) {
        // Store user ID in jsPsych data for all subsequent trials
        jsPsych.data.addProperties({
          user_id: currentUserId
        });
      }
    });
    
    // Focus on input field
    userIdInput.focus();
  },
  on_finish: function(data) {
    // The user ID should already be stored in jsPsych data from the button click
    const allData = jsPsych.data.get();
    const userIdFromData = allData.values()[0]?.user_id;
    if (userIdFromData) {
      data.user_id = userIdFromData;
    }
  }
});

// Visual Angle Calculator UI
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #ccc;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
      }
      .calculator-container {
        text-align: center;
        color: black;
        background: white;
        padding: 40px;
        border-radius: 15px;
        box-shadow: 0 6px 12px rgba(0,0,0,0.3);
        max-width: 700px;
        width: 90%;
      }
      .calculator-title {
        font-size: 28px;
        margin-bottom: 10px;
        color: #2c3e50;
      }
      .calculator-subtitle {
        font-size: 16px;
        color: #7f8c8d;
        margin-bottom: 30px;
      }
      .input-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 25px;
        margin: 30px 0;
      }
      .input-section {
        background: #f8f9fa;
        padding: 20px;
        border-radius: 10px;
        border-left: 4px solid #3498db;
      }
      .section-title {
        font-size: 18px;
        font-weight: bold;
        color: #2c3e50;
        margin-bottom: 15px;
      }
      .input-group {
        margin: 15px 0;
        text-align: left;
      }
      .input-label {
        display: block;
        font-size: 14px;
        color: #34495e;
        margin-bottom: 5px;
        font-weight: 500;
      }
      .calculator-input {
        width: 100%;
        padding: 10px;
        border: 2px solid #bdc3c7;
        border-radius: 5px;
        font-size: 16px;
        text-align: center;
        box-sizing: border-box;
      }
      .calculator-input:focus {
        border-color: #3498db;
        outline: none;
      }
      .calculator-input.invalid {
        border-color: #e74c3c;
      }
      .unit-label {
        font-size: 12px;
        color: #95a5a6;
        margin-top: 3px;
      }
      .error-message {
        color: #e74c3c;
        font-size: 12px;
        margin-top: 5px;
        display: none;
      }
      .preview-section {
        background: #e8f4fd;
        padding: 20px;
        border-radius: 10px;
        margin: 20px 0;
        border-left: 4px solid #3498db;
      }
      .preview-title {
        font-size: 16px;
        font-weight: bold;
        color: #2c3e50;
        margin-bottom: 10px;
      }
      .preview-text {
        font-size: 14px;
        color: #34495e;
        margin: 5px 0;
      }
      .instructions {
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        padding: 15px;
        border-radius: 8px;
        margin: 20px 0;
        font-size: 14px;
        color: #856404;
      }
    </style>
    <div class="calculator-container">
      <div class="calculator-title">Visual Angle Calculator</div>
      <div class="calculator-subtitle">Enter your display setup parameters for accurate visual angle calculations</div>
      
      <div class="instructions">
        Please measure and enter your exact display parameters. These will be used to calculate precise visual angles for the experiment.
      </div>
      
      <div class="input-grid">
        <div class="input-section">
          <div class="section-title">Screen Resolution</div>
          <div class="input-group">
            <label class="input-label">Width (pixels)</label>
            <input type="number" id="resolution-width" class="calculator-input" placeholder="1920" value="1920">
            <div class="error-message" id="resolution-width-error">Please enter a valid resolution</div>
          </div>
          <div class="input-group">
            <label class="input-label">Height (pixels)</label>
            <input type="number" id="resolution-height" class="calculator-input" placeholder="1080" value="1080">
            <div class="error-message" id="resolution-height-error">Please enter a valid resolution</div>
          </div>
        </div>
        
        <div class="input-section">
          <div class="section-title">Screen Dimensions</div>
          <div class="input-group">
            <label class="input-label">Width (cm)</label>
            <input type="number" id="screen-width" class="calculator-input" placeholder="47.6" step="0.1" value="47.6">
            <div class="unit-label">Measure the visible screen width</div>
            <div class="error-message" id="screen-width-error">Please enter a valid dimension</div>
          </div>
          <div class="input-group">
            <label class="input-label">Height (cm)</label>
            <input type="number" id="screen-height" class="calculator-input" placeholder="26.8" step="0.1" value="26.8">
            <div class="unit-label">Measure the visible screen height</div>
            <div class="error-message" id="screen-height-error">Please enter a valid dimension</div>
          </div>
        </div>
      </div>
      
      <div class="input-section" style="margin: 20px 0;">
        <div class="section-title">Viewing Distance</div>
        <div class="input-group">
          <label class="input-label">Distance from screen (cm)</label>
          <input type="number" id="viewing-distance" class="calculator-input" placeholder="50" step="0.5" value="50">
          <div class="unit-label">Measure from your eyes to the screen</div>
          <div class="error-message" id="viewing-distance-error">Please enter a valid distance</div>
        </div>
      </div>
      
      <div class="preview-section">
        <div class="preview-title">Calculated Values</div>
        <div class="preview-text">Pixels per degree: <span id="preview-ppd">--</span></div>
        <div class="preview-text">Pixels per cm (X): <span id="preview-ppcm-x">--</span></div>
        <div class="preview-text">Pixels per cm (Y): <span id="preview-ppcm-y">--</span></div>
      </div>
    </div>
  `,
  choices: ['Continue with Experiment'],
  button_html: (choice) => `<div class="my-btn-container"><button class="jspsych-btn" id="continue-calc-btn" style="margin-top: 20px; padding: 12px 24px; font-size: 16px;">${choice}</button></div>`,
  on_load: function() {
    const continueBtn = document.getElementById('continue-calc-btn');
    const inputs = {
      resWidth: document.getElementById('resolution-width'),
      resHeight: document.getElementById('resolution-height'),
      screenWidth: document.getElementById('screen-width'),
      screenHeight: document.getElementById('screen-height'),
      viewingDistance: document.getElementById('viewing-distance')
    };
    
    const previews = {
      ppd: document.getElementById('preview-ppd'),
      ppcmX: document.getElementById('preview-ppcm-x'),
      ppcmY: document.getElementById('preview-ppcm-y')
    };
    
    // Disable continue button initially
    continueBtn.disabled = true;
    continueBtn.style.opacity = '0.5';
    
    function validateInput(input, min = 1, max = 10000) {
      const value = parseFloat(input.value);
      return !isNaN(value) && value >= min && value <= max;
    }
    
    function updateCalculations() {
      const values = {
        resWidth: parseFloat(inputs.resWidth.value),
        resHeight: parseFloat(inputs.resHeight.value),
        screenWidth: parseFloat(inputs.screenWidth.value),
        screenHeight: parseFloat(inputs.screenHeight.value),
        viewingDistance: parseFloat(inputs.viewingDistance.value)
      };
      
      // Check if all values are valid
      const allValid = Object.values(values).every(v => !isNaN(v) && v > 0);
      
      if (allValid) {
        // Calculate pixels per cm
        const pixelsPerCmX = values.resWidth / values.screenWidth;
        const pixelsPerCmY = values.resHeight / values.screenHeight;
        
        // Calculate pixels per degree
        // For 1 degree visual angle: tan(1°) * viewing distance = cm
        const cmPerDegree = Math.tan(Math.PI / 180) * values.viewingDistance;
        const pixelsPerDegree = (pixelsPerCmX + pixelsPerCmY) / 2 * cmPerDegree;
        
        // Update previews
        previews.ppd.textContent = pixelsPerDegree.toFixed(2);
        previews.ppcmX.textContent = pixelsPerCmX.toFixed(2);
        previews.ppcmY.textContent = pixelsPerCmY.toFixed(2);
        
        // Enable continue button
        continueBtn.disabled = false;
        continueBtn.style.opacity = '1';
      } else {
        previews.ppd.textContent = '--';
        previews.ppcmX.textContent = '--';
        previews.ppcmY.textContent = '--';
        
        continueBtn.disabled = true;
        continueBtn.style.opacity = '0.5';
      }
    }
    
    // Add validation and calculation for all inputs
    Object.values(inputs).forEach(input => {
      input.addEventListener('input', function() {
        const isValid = validateInput(this);
        this.classList.toggle('invalid', !isValid);
        updateCalculations();
      });
    });
    
    // Store the calculated parameters when continue is clicked
    continueBtn.addEventListener('click', function() {
      const calculatorData = {
        resolution: [parseFloat(inputs.resWidth.value), parseFloat(inputs.resHeight.value)],
        screenSizeCm: [parseFloat(inputs.screenWidth.value), parseFloat(inputs.screenHeight.value)],
        viewingDistanceCm: parseFloat(inputs.viewingDistance.value),
        pixelsPerCmX: parseFloat(inputs.resWidth.value) / parseFloat(inputs.screenWidth.value),
        pixelsPerCmY: parseFloat(inputs.resHeight.value) / parseFloat(inputs.screenHeight.value),
        pixelsPerDegree: parseFloat(previews.ppd.textContent)
      };
      
      // Store in jsPsych data
      jsPsych.data.addProperties({
        calculator_data: calculatorData
      });
    });
    
    // Initial calculation
    updateCalculations();
  },
  on_finish: function(data) {
    // Data is already stored in jsPsych via the button click event
  }
});

// Original chinrest trial (commented out for manual visual angle calculation)
// var chinrestTrial = {
// 	type: jsPsychVirtualChinrest,
// 	blindspot_reps: 3,
// 	resize_units: "none"
// };
// timeline.push(chinrestTrial);

// Clinic version uses the combination generation functions below

// CLINIC VERSION - Randomized blocks with breaks for each stimulus type

// === MOTION TRIALS ===
// 8 base trials × 12 blocks = 96 trials
// Break after every 3 blocks (24 trials)
const motionCombinations = generateMotionTrialCombinations();
const motionTotalTrials = 12 * motionCombinations.length; // 12 blocks × 8 combinations
let motionTrialCounter = 0;

// Ready screen before Motion trials
timeline.push(createReadyScreen('Motion Discrimination Task'));

// for (let block = 1; block <= 12; block++) {
for (let block = 1; block <= 12; block++) {
  // Add ready screen after every 3 blocks (except the first block)
  if (block > 1 && (block - 1) % 3 === 0) {
    timeline.push(createReadyScreen('Next Motion Block'));
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(motionCombinations);
  for (const combination of randomizedBlock) {
    motionTrialCounter++;
    const trialSequence = generateMotionTrialSequence(combination, 'Motion', motionTrialCounter, motionTotalTrials);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// === GRATING TRIALS ===
// 8 base trials × 12 blocks = 96 trials  
// Break after every 3 blocks (24 trials)
const gratingCombinations = generateGratingTrialCombinations();
const gratingTotalTrials = 12 * gratingCombinations.length; // 12 blocks × 8 combinations
let gratingTrialCounter = 0;

// Ready screen before Orientation trials
timeline.push(createReadyScreen('Orientation Discrimination Task'));

for (let block = 1; block <= 12; block++) {
  // Add ready screen after every 3 blocks (except the first block)
  if (block > 1 && (block - 1) % 3 === 0) {
    timeline.push(createReadyScreen('Next Orientation Block'));
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(gratingCombinations);
  for (const combination of randomizedBlock) {
    gratingTrialCounter++;
    const trialSequence = generateGratingTrialSequence(combination, 'Orientation', gratingTrialCounter, gratingTotalTrials);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// === GRID TRIALS ===
// 16 base trials × 6 blocks = 96 trials
// Break after every 2 blocks (32 trials)
const gridCombinations = generateGridTrialCombinations();
const gridTotalTrials = 6 * gridCombinations.length; // 6 blocks × 16 combinations
let gridTrialCounter = 0;

// Ready screen before Centrality trials
timeline.push(createReadyScreen('Centrality Discrimination Task'));

for (let block = 1; block <= 6; block++) {
  // Add ready screen after every 2 blocks (except the first block)
  if (block > 1 && (block - 1) % 2 === 0) {
    timeline.push(createReadyScreen('Next Centrality Block'));
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(gridCombinations);
  for (const combination of randomizedBlock) {
    gridTrialCounter++;
    const trialSequence = generateGridTrialSequence(combination, 'Centrality', gridTrialCounter, gridTotalTrials);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// === BAR CHART TRIALS ===
// 12 base trials × 8 blocks = 96 trials
// Break after every 2 blocks (24 trials)
const barChartCombinations = generateBarChartTrialCombinations();
const barTotalTrials = 8 * barChartCombinations.length; // 8 blocks × 12 combinations
let barTrialCounter = 0;

// Ready screen before Bar trials
timeline.push(createReadyScreen('Bar Comparison Task'));

for (let block = 1; block <= 8; block++) {
  // Add ready screen after every 2 blocks (except the first block)
  if (block > 1 && (block - 1) % 2 === 0) {
    timeline.push(createReadyScreen('Next Bar Block'));
  }
  
  // Generate randomized block
  const randomizedBlock = shuffleArray(barChartCombinations);
  for (const combination of randomizedBlock) {
    barTrialCounter++;
    const trialSequence = generateBarChartTrialSequence(combination, 'Bar', barTrialCounter, barTotalTrials);
    for (const trial of trialSequence) {
      timeline.push(trial);
    }
  }
}

// Results and download screen
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: function() {
    // Calculate accuracy for each trial type
    const allData = jsPsych.data.get();
    
    // Filter response trials only (those with 'correct' property)
    const responseTrials = allData.filter({correct: true}).trials.concat(
      allData.filter({correct: false}).trials
    );
    
    // Calculate accuracy for Motion trials (signalDirection data)
    const motionTrials = responseTrials.filter(trial => 
      trial.correct_direction === 'Up' || trial.correct_direction === 'Down'
    );
    const motionCorrect = motionTrials.filter(trial => trial.correct === true).length;
    const motionAccuracy = motionTrials.length > 0 ? (motionCorrect / motionTrials.length * 100).toFixed(1) : 0;
    
    // Calculate accuracy for Grating trials (orientation data)
    const gratingTrials = responseTrials.filter(trial => 
      trial.correct_direction === 'Vertical' || trial.correct_direction === 'Horizontal'
    );
    const gratingCorrect = gratingTrials.filter(trial => trial.correct === true).length;
    const gratingAccuracy = gratingTrials.length > 0 ? (gratingCorrect / gratingTrials.length * 100).toFixed(1) : 0;
    
    // Calculate accuracy for Grid trials (Black/White data)
    const gridTrials = responseTrials.filter(trial => 
      trial.correct_direction === 'Black' || trial.correct_direction === 'White'
    );
    const gridCorrect = gridTrials.filter(trial => trial.correct === true).length;
    const gridAccuracy = gridTrials.length > 0 ? (gridCorrect / gridTrials.length * 100).toFixed(1) : 0;
    
    // Calculate accuracy for Bar Chart trials (Same/Different data)
    const barTrials = responseTrials.filter(trial => 
      trial.correct_direction === 'Same' || trial.correct_direction === 'Different'
    );
    const barCorrect = barTrials.filter(trial => trial.correct === true).length;
    const barAccuracy = barTrials.length > 0 ? (barCorrect / barTrials.length * 100).toFixed(1) : 0;
    
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
        .results-container {
          text-align: center;
          color: black;
          background: white;
          padding: 40px;
          border-radius: 15px;
          box-shadow: 0 6px 12px rgba(0,0,0,0.3);
          max-width: 600px;
        }
        .results-title {
          font-size: 28px;
          margin-bottom: 30px;
          color: #2c3e50;
        }
        .accuracy-section {
          margin: 25px 0;
        }
        .accuracy-title {
          font-size: 22px;
          margin-bottom: 20px;
          color: #34495e;
          border-bottom: 2px solid #ecf0f1;
          padding-bottom: 10px;
        }
        .accuracy-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 20px 0;
        }
        .accuracy-item {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #3498db;
        }
        .accuracy-label {
          font-size: 16px;
          color: #7f8c8d;
          margin-bottom: 5px;
        }
        .accuracy-value {
          font-size: 24px;
          font-weight: bold;
          color: #2c3e50;
        }
        .download-section {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 2px solid #ecf0f1;
        }
        .download-instruction {
          font-size: 16px;
          margin-bottom: 20px;
          color: #7f8c8d;
        }
        .summary-stats {
          background: #e8f4fd;
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
          border-left: 4px solid #3498db;
        }
        .summary-text {
          font-size: 14px;
          color: #2c3e50;
          margin: 5px 0;
        }
        .server-status {
          background: #fff3cd;
          border: 1px solid #ffeaa7;
          padding: 10px;
          border-radius: 6px;
          margin: 10px 0;
          font-size: 14px;
          color: #856404;
        }
        .server-status.success {
          background: #d4edda;
          border-color: #c3e6cb;
          color: #155724;
        }
        .server-status.error {
          background: #f8d7da;
          border-color: #f5c6cb;
          color: #721c24;
        }
      </style>
      <div class="results-container">
        <div class="results-title">🎉 Experiment Complete!</div>
        
        <div class="accuracy-section">
          <div class="accuracy-title">Your Performance Results</div>
          <div class="accuracy-grid">
            <div class="accuracy-item">
              <div class="accuracy-label">Motion Trials</div>
              <div class="accuracy-value">${motionAccuracy}%</div>
            </div>
            <div class="accuracy-item">
              <div class="accuracy-label">Grating Trials</div>
              <div class="accuracy-value">${gratingAccuracy}%</div>
            </div>
            <div class="accuracy-item">
              <div class="accuracy-label">Grid Trials</div>
              <div class="accuracy-value">${gridAccuracy}%</div>
            </div>
            <div class="accuracy-item">
              <div class="accuracy-label">Bar Chart Trials</div>
              <div class="accuracy-value">${barAccuracy}%</div>
            </div>
          </div>
          
          <div class="summary-stats">
            <div class="summary-text"><strong>Motion Trials:</strong> ${motionCorrect}/${motionTrials.length} correct</div>
            <div class="summary-text"><strong>Grating Trials:</strong> ${gratingCorrect}/${gratingTrials.length} correct</div>
            <div class="summary-text"><strong>Grid Trials:</strong> ${gridCorrect}/${gridTrials.length} correct</div>
            <div class="summary-text"><strong>Bar Chart Trials:</strong> ${barCorrect}/${barTrials.length} correct</div>
          </div>
        </div>
        
        <div class="download-section">
          <div class="download-instruction">Your data has been automatically saved to the server</div>
          <div id="server-save-status" class="server-status">
            <span id="save-status-text">Saving data to server...</span>
            <span id="save-status-icon">⏳</span>
          </div>
          <div class="download-instruction" style="margin-top: 15px;">You can also download your detailed results as a CSV file</div>
        </div>
      </div>
    `;
  },
  choices: ['Download CSV', 'Finish'],
  button_html: (choice) => {
    if (choice === 'Download CSV') {
      return `<button class="jspsych-btn" id="download-btn" style="background-color: #27ae60; color: white; margin: 10px; padding: 12px 24px; font-size: 16px;">${choice}</button>`;
    } else {
      return `<button class="jspsych-btn" id="finish-btn" style="background-color: #95a5a6; color: white; margin: 10px; padding: 12px 24px; font-size: 16px;">${choice}</button>`;
    }
  },
  on_load: function() {
    const downloadBtn = document.getElementById('download-btn');
    const saveStatusText = document.getElementById('save-status-text');
    const saveStatusIcon = document.getElementById('save-status-icon');
    const serverStatus = document.getElementById('server-save-status');
    
    // Get all experiment data
    const allData = jsPsych.data.get();
    const csvData = allData.csv();
    
    // Get user ID for filename
    const userId = allData.values()[0].user_id || 'unknown';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `user_${userId}_${timestamp}.csv`;
    
    console.log('Generated filename:', filename);
    console.log('User ID:', userId);
    console.log('Timestamp:', timestamp);
    
    // Check if we're in development mode (Vite dev server)
    const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost' && window.location.port !== '8000';
    
    if (isDevelopment) {
      // Skip server save in development mode
      saveStatusText.textContent = 'Development mode - server save disabled';
      saveStatusIcon.textContent = 'ℹ️';
      serverStatus.classList.add('success');
      serverStatus.style.background = '#e7f3ff';
      serverStatus.style.borderColor = '#b3d9ff';
      serverStatus.style.color = '#0066cc';
    } else {
      // Automatically save data to server
      saveDataToServer(filename, csvData)
        .then(response => {
          saveStatusText.textContent = `Data saved successfully: ${response.filename}`;
          saveStatusIcon.textContent = '✅';
          serverStatus.classList.add('success');
          console.log('Server save successful:', response);
        })
        .catch(error => {
          saveStatusText.textContent = `Server save failed: ${error.message}`;
          saveStatusIcon.textContent = '❌';
          serverStatus.classList.add('error');
          console.error('Server save error:', error);
        });
    }
    
    // Download button functionality
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        // Create and download the file
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Update button to show download completed
        downloadBtn.textContent = '✓ Downloaded';
        downloadBtn.style.backgroundColor = '#2ecc71';
        downloadBtn.disabled = true;
      });
    }
  },
  on_finish: function(data) {
    if (data.response === 1) { // Finish button clicked
      // Show thank you message
      document.body.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #ccc; font-family: Arial, sans-serif;">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 6px 12px rgba(0,0,0,0.3);">
            <h2 style="color: #2c3e50; margin-bottom: 20px;">Thank You!</h2>
            <p style="font-size: 18px; color: #7f8c8d;">Your participation in this experiment is greatly appreciated.</p>
            <p style="font-size: 16px; color: #95a5a6; margin-top: 20px;">You may now close this window.</p>
          </div>
        </div>
      `;
    }
  }
});

jsPsych.run(timeline);