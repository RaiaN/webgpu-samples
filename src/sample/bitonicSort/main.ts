import { makeSample, SampleInit } from '../../components/SampleLayout';
import { createBindGroupCluster, SampleInitFactoryWebGPU } from './utils';
import BitonicDisplayRenderer from './bitonicDisplay';
import bitonicDisplay from './bitonicDisplay.frag.wgsl';
import { NaiveBitonicCompute } from './bitonicCompute';
import fullscreenTexturedQuad from '../../shaders/fullscreenTexturedQuad.wgsl';
import atomicToZero from './atomicToZero.wgsl';

// Type of step that will be executed in our shader
enum StepEnum {
  NONE,
  FLIP_LOCAL,
  DISPERSE_LOCAL,
  FLIP_GLOBAL,
  DISPERSE_GLOBAL,
}

type StepType =
  // NONE: No sort step has or will occur
  | 'NONE'
  // FLIP_LOCAL: A sort step that performs a flip operation over indices in a workgroup's locally addressable area
  // (i.e invocations * workgroup_index -> invocations * (workgroup_index + 1) - 1.
  | 'FLIP_LOCAL'
  // DISPERSE_LOCAL A sort step that performs a flip operation over indices in a workgroup's locally addressable area.
  | 'DISPERSE_LOCAL'
  // FLIP_GLOBAL A sort step that performs a flip step across a range of indices outside a workgroup's locally addressable area.
  | 'FLIP_GLOBAL'
  // DISPERSE_GLOBAL A sort step that performs a disperse operation across a range of indices outside a workgroup's locally addressable area.
  | 'DISPERSE_GLOBAL';

type DisplayType = 'Elements' | 'Swap Highlight';

// Gui settings object
interface SettingsInterface {
  'Total Elements': number;
  'Grid Width': number;
  'Grid Height': number;
  'Grid Dimensions': string;
  'Workgroup Size': number;
  'Size Limit': number;
  'Workgroups Per Step': number;
  'Hovered Cell': number;
  'Swapped Cell': number;
  'Current Step': string;
  'Step Index': number;
  'Total Steps': number;
  'Prev Step': StepType;
  'Next Step': StepType;
  'Prev Swap Span': number;
  'Next Swap Span': number;
  executeStep: boolean;
  'Randomize Values': () => void;
  'Execute Sort Step': () => void;
  'Log Elements': () => void;
  'Complete Sort': () => void;
  'Sort Speed': number;
  'Display Mode': DisplayType;
  'Total Swaps': number;
}

const getNumSteps = (numElements: number) => {
  const n = Math.log2(numElements);
  return (n * (n + 1)) / 2;
};

let init: SampleInit;
SampleInitFactoryWebGPU(
  async ({ pageState, device, gui, presentationFormat, context, canvas }) => {
    const maxInvocationsX = device.limits.maxComputeWorkgroupSizeX;

    const totalElementOptions = [];
    const maxElements = maxInvocationsX * 32;
    for (let i = maxElements; i >= 4; i /= 2) {
      totalElementOptions.push(i);
    }

    const sizeLimitOptions: number[] = [];
    for (let i = maxInvocationsX; i >= 2; i /= 2) {
      sizeLimitOptions.push(i);
    }

    const defaultGridWidth =
      Math.sqrt(maxElements) % 2 === 0
        ? Math.floor(Math.sqrt(maxElements))
        : Math.floor(Math.sqrt(maxElements / 2));

    const defaultGridHeight = maxElements / defaultGridWidth;

    const settings: SettingsInterface = {
      // TOTAL ELEMENT AND GRID SETTINGS
      // The number of elements to be sorted. Must equal gridWidth * gridHeight || Workgroup Size * Workgroups * 2
      // When changed, all relevant values within the settings object are reset to their defaults at the beginning of a sort with n elements.
      'Total Elements': maxElements,
      // width of screen in cells
      'Grid Width': defaultGridWidth,
      // height of screen in cells
      'Grid Height': defaultGridHeight,
      // Grid Dimensions as string
      'Grid Dimensions': `${defaultGridWidth}x${defaultGridHeight}`,

      // INVOCATION, WORKGROUP SIZE, AND WORKGROUP DISPATCH SETTINGS
      // The size of a workgroup, or the number of invocations executed within each workgroup
      // Determined algorithmically based on 'Size Limit', maxInvocationsX, and the current number of elements to sort
      'Workgroup Size': maxInvocationsX,
      // An artifical constraint on the maximum workgroup size/maximumn invocations per workgroup as specified by device.limits.maxComputeWorkgroupSizeX
      'Size Limit': maxInvocationsX,
      // Total workgroups that are dispatched during each step of the bitonic sort
      'Workgroups Per Step': maxElements / (maxInvocationsX * 2),

      // HOVER SETTINGS
      // The element/cell in the element visualizer directly beneath the mouse cursor
      'Hovered Cell': 0,
      // The element/cell in the element visualizer that the hovered cell will swap with in the next execution step of the bitonic sort.
      'Swapped Cell': 1,

      // STEP INDEX, STEP TYPE, AND STEP SWAP SPAN SETTINGS
      // The index of the current step in the bitonic sort.
      'Step Index': 0,
      // The total number of steps required to sort the displayed elements.
      'Total Steps': getNumSteps(maxElements),
      // A string that condenses 'Step Index' and 'Total Steps' into a single GUI Controller display element.
      'Current Step': `0 of 91`,
      // The category of the previously executed step. Always begins the bitonic sort with a value of 'NONE' and ends with a value of 'DISPERSE_LOCAL'
      'Prev Step': 'NONE',
      // The category of the next step that will be executed. Always begins the bitonic sort with a value of 'FLIP_LOCAL' and ends with a value of 'NONE'
      'Next Step': 'FLIP_LOCAL',
      // The maximum span of a swap operation in the sort's previous step.
      'Prev Swap Span': 0,
      // The maximum span of a swap operation in the sort's upcoming step.
      'Next Swap Span': 2,

      // ANIMATION LOOP AND FUNCTION SETTINGS
      // A flag that designates whether we will dispatch a workload this frame.
      executeStep: false,
      // A function that randomizes the values of each element.
      // When called, all relevant values within the settings object are reset to their defaults at the beginning of a sort with n elements.
      'Randomize Values': () => {
        return;
      },
      // A function that manually executes a single step of the bitonic sort.
      'Execute Sort Step': () => {
        return;
      },
      // A function that logs the values of each element as an array to the browser's console.
      'Log Elements': () => {
        return;
      },
      // A function that automatically executes each step of the bitonic sort at an interval determined by 'Sort Speed'
      'Complete Sort': () => {
        return;
      },
      // The speed at which each step of the bitonic sort will be executed after 'Complete Sort' has been called.
      'Sort Speed': 50,

      // MISCELLANEOUS SETTINGS
      'Display Mode': 'Elements',
      // An atomic value representing the total number of swap operations executed over the course of the bitonic sort.
      'Total Swaps': 0,
    };

    // Initialize initial elements array
    let elements = new Uint32Array(
      Array.from({ length: settings['Total Elements'] }, (_, i) => i)
    );

    // Initialize elementsBuffer and elementsStagingBuffer
    const elementsBufferSize =
      Float32Array.BYTES_PER_ELEMENT * totalElementOptions[0];
    // Initialize input, output, staging buffers
    const elementsInputBuffer = device.createBuffer({
      size: elementsBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const elementsOutputBuffer = device.createBuffer({
      size: elementsBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const elementsStagingBuffer = device.createBuffer({
      size: elementsBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Initialize atomic swap buffer on GPU and CPU. Counts number of swaps actually performed by
    // compute shader (when value at index x is greater than value at index y)
    const atomicSwapsOutputBuffer = device.createBuffer({
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const atomicSwapsStagingBuffer = device.createBuffer({
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create uniform buffer for compute shader
    const computeUniformsBuffer = device.createBuffer({
      // width, height, blockHeight, algo
      size: Float32Array.BYTES_PER_ELEMENT * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const computeBGCluster = createBindGroupCluster(
      [0, 1, 2, 3],
      [
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        GPUShaderStage.COMPUTE,
        GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        GPUShaderStage.COMPUTE,
      ],
      ['buffer', 'buffer', 'buffer', 'buffer'],
      [
        { type: 'read-only-storage' },
        { type: 'storage' },
        { type: 'uniform' },
        { type: 'storage' },
      ],
      [
        [
          { buffer: elementsInputBuffer },
          { buffer: elementsOutputBuffer },
          { buffer: computeUniformsBuffer },
          { buffer: atomicSwapsOutputBuffer },
        ],
      ],
      'BitonicSort',
      device
    );

    let computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [computeBGCluster.bindGroupLayout],
      }),
      compute: {
        module: device.createShaderModule({
          code: NaiveBitonicCompute(settings['Workgroup Size']),
        }),
        entryPoint: 'computeMain',
      },
    });

    // Simple pipeline that zeros out an atomic value at group 0 binding 3
    const atomicToZeroComputePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [computeBGCluster.bindGroupLayout],
      }),
      compute: {
        module: device.createShaderModule({
          code: atomicToZero,
        }),
        entryPoint: 'atomicToZero',
      },
    });

    // Create bitonic debug renderer
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: undefined, // Assigned later

          clearValue: { r: 0.1, g: 0.4, b: 0.5, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const bitonicDisplayRenderer = new BitonicDisplayRenderer(
      device,
      presentationFormat,
      renderPassDescriptor,
      computeBGCluster,
      'BitonicDisplay'
    );

    const resetExecutionInformation = () => {
      // The workgroup size is either elements / 2 or Size Limit
      workgroupSizeController.setValue(
        Math.min(settings['Total Elements'] / 2, settings['Size Limit'])
      );

      // Dispatch a workgroup for every (Size Limit * 2) elements
      const workgroupsPerStep =
        (settings['Total Elements'] - 1) / (settings['Size Limit'] * 2);

      workgroupsPerStepController.setValue(Math.ceil(workgroupsPerStep));

      // Reset step Index and number of steps based on elements size
      settings['Step Index'] = 0;
      settings['Total Steps'] = getNumSteps(settings['Total Elements']);
      currentStepController.setValue(
        `${settings['Step Index']} of ${settings['Total Steps']}`
      );

      // Get new width and height of screen display in cells
      const newCellWidth =
        Math.sqrt(settings['Total Elements']) % 2 === 0
          ? Math.floor(Math.sqrt(settings['Total Elements']))
          : Math.floor(Math.sqrt(settings['Total Elements'] / 2));
      const newCellHeight = settings['Total Elements'] / newCellWidth;
      settings['Grid Width'] = newCellWidth;
      settings['Grid Height'] = newCellHeight;
      gridDimensionsController.setValue(`${newCellWidth}x${newCellHeight}`);

      // Set prevStep to None (restart) and next step to FLIP
      prevStepController.setValue('NONE');
      nextStepController.setValue('FLIP_LOCAL');

      // Reset block heights
      prevBlockHeightController.setValue(0);
      nextBlockHeightController.setValue(2);

      // Reset Total Swaps by setting atomic value to 0
      const commandEncoder = device.createCommandEncoder();
      const computePassEncoder = commandEncoder.beginComputePass();
      computePassEncoder.setPipeline(atomicToZeroComputePipeline);
      computePassEncoder.setBindGroup(0, computeBGCluster.bindGroups[0]);
      computePassEncoder.dispatchWorkgroups(1);
      computePassEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
      totalSwapsController.setValue(0);

      highestBlockHeight = 2;
    };

    const randomizeElementArray = () => {
      let currentIndex = elements.length;
      // While there are elements to shuffle
      while (currentIndex !== 0) {
        // Pick a remaining element
        const randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        [elements[currentIndex], elements[randomIndex]] = [
          elements[randomIndex],
          elements[currentIndex],
        ];
      }
    };

    const resizeElementArray = () => {
      // Recreate elements array with new length
      elements = new Uint32Array(
        Array.from({ length: settings['Total Elements'] }, (_, i) => i)
      );

      resetExecutionInformation();

      // Create new shader invocation with workgroupSize that reflects number of invocations
      computePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [computeBGCluster.bindGroupLayout],
        }),
        compute: {
          module: device.createShaderModule({
            code: NaiveBitonicCompute(
              Math.min(settings['Total Elements'] / 2, settings['Size Limit'])
            ),
          }),
          entryPoint: 'computeMain',
        },
      });
      // Randomize array elements
      randomizeElementArray();
      highestBlockHeight = 2;
    };

    randomizeElementArray();

    const setSwappedCell = () => {
      let swappedIndex: number;
      switch (settings['Next Step']) {
        case 'FLIP_LOCAL':
        case 'FLIP_GLOBAL':
          {
            const blockHeight = settings['Next Swap Span'];
            const p2 = Math.floor(settings['Hovered Cell'] / blockHeight) + 1;
            const p3 = settings['Hovered Cell'] % blockHeight;
            swappedIndex = blockHeight * p2 - p3 - 1;
            swappedCellController.setValue(swappedIndex);
          }
          break;
        case 'DISPERSE_LOCAL':
          {
            const blockHeight = settings['Next Swap Span'];
            const halfHeight = blockHeight / 2;
            swappedIndex =
              settings['Hovered Cell'] % blockHeight < halfHeight
                ? settings['Hovered Cell'] + halfHeight
                : settings['Hovered Cell'] - halfHeight;
            swappedCellController.setValue(swappedIndex);
          }
          break;
        case 'NONE': {
          swappedIndex = settings['Hovered Cell'];
          swappedCellController.setValue(swappedIndex);
        }
        default:
          {
            swappedIndex = settings['Hovered Cell'];
            swappedCellController.setValue(swappedIndex);
          }
          break;
      }
    };

    let completeSortIntervalID: ReturnType<typeof setInterval> | null = null;
    const endSortInterval = () => {
      if (completeSortIntervalID !== null) {
        clearInterval(completeSortIntervalID);
        completeSortIntervalID = null;
      }
    };
    const startSortInterval = () => {
      const currentIntervalSpeed = settings['Sort Speed'];
      completeSortIntervalID = setInterval(() => {
        if (settings['Next Step'] === 'NONE') {
          clearInterval(completeSortIntervalID);
          completeSortIntervalID = null;
          sizeLimitController.domElement.style.pointerEvents = 'auto';
        }
        if (settings['Sort Speed'] !== currentIntervalSpeed) {
          clearInterval(completeSortIntervalID);
          completeSortIntervalID = null;
          startSortInterval();
        }
        settings.executeStep = true;
        setSwappedCell();
      }, settings['Sort Speed']);
    };

    // At top level, information about resources used to execute the compute shader
    // i.e elements sorted, invocations per workgroup, and workgroups dispatched
    const computeResourcesFolder = gui.addFolder('Compute Resources');
    computeResourcesFolder
      .add(settings, 'Total Elements', totalElementOptions)
      .onChange(() => {
        endSortInterval();
        resizeElementArray();
        sizeLimitController.domElement.style.pointerEvents = 'auto';
      });
    const sizeLimitController = computeResourcesFolder
      .add(settings, 'Size Limit', sizeLimitOptions)
      .onChange(() => {
        const constraint = Math.min(
          settings['Total Elements'] / 2,
          settings['Size Limit']
        );
        const workgroupsPerStep =
          (settings['Total Elements'] - 1) / (settings['Size Limit'] * 2);
        workgroupSizeController.setValue(constraint);
        workgroupsPerStepController.setValue(Math.ceil(workgroupsPerStep));
        computePipeline = computePipeline = device.createComputePipeline({
          layout: device.createPipelineLayout({
            bindGroupLayouts: [computeBGCluster.bindGroupLayout],
          }),
          compute: {
            module: device.createShaderModule({
              code: NaiveBitonicCompute(
                Math.min(settings['Total Elements'] / 2, settings['Size Limit'])
              ),
            }),
            entryPoint: 'computeMain',
          },
        });
      });
    const workgroupSizeController = computeResourcesFolder.add(
      settings,
      'Workgroup Size'
    );
    const workgroupsPerStepController = computeResourcesFolder.add(
      settings,
      'Workgroups Per Step'
    );
    computeResourcesFolder.open();

    // Folder with functions that control the execution of the sort
    const controlFolder = gui.addFolder('Sort Controls');
    controlFolder.add(settings, 'Sort Speed', 50, 1000).step(50);
    controlFolder.add(settings, 'Execute Sort Step').onChange(() => {
      // Size Limit locked upon sort
      sizeLimitController.domElement.style.pointerEvents = 'none';
      endSortInterval();
      settings.executeStep = true;
    });
    controlFolder.add(settings, 'Randomize Values').onChange(() => {
      endSortInterval();
      randomizeElementArray();
      resetExecutionInformation();
      // Unlock workgroup size limit controller since sort has stopped
      sizeLimitController.domElement.style.pointerEvents = 'auto';
    });
    controlFolder
      .add(settings, 'Log Elements')
      .onChange(() => console.log(elements));
    controlFolder.add(settings, 'Complete Sort').onChange(() => {
      // Invocation Limit locked upon sort
      sizeLimitController.domElement.style.pointerEvents = 'none';
      startSortInterval();
    });
    controlFolder.open();

    // Information about grid display
    const gridFolder = gui.addFolder('Grid Information');
    gridFolder.add(settings, 'Display Mode', ['Elements', 'Swap Highlight']);
    const gridDimensionsController = gridFolder.add(
      settings,
      'Grid Dimensions'
    );
    const hoveredCellController = gridFolder
      .add(settings, 'Hovered Cell')
      .onChange(setSwappedCell);
    const swappedCellController = gridFolder.add(settings, 'Swapped Cell');

    // Additional Information about the execution state of the sort
    const executionInformationFolder = gui.addFolder('Execution Information');
    const currentStepController = executionInformationFolder.add(
      settings,
      'Current Step'
    );
    const prevStepController = executionInformationFolder.add(
      settings,
      'Prev Step'
    );
    const nextStepController = executionInformationFolder.add(
      settings,
      'Next Step'
    );
    const totalSwapsController = executionInformationFolder.add(
      settings,
      'Total Swaps'
    );
    const prevBlockHeightController = executionInformationFolder.add(
      settings,
      'Prev Swap Span'
    );
    const nextBlockHeightController = executionInformationFolder.add(
      settings,
      'Next Swap Span'
    );

    // Adjust styles of Function List Elements within GUI
    const liFunctionElements = document.getElementsByClassName('cr function');
    for (let i = 0; i < liFunctionElements.length; i++) {
      (liFunctionElements[i].children[0] as HTMLElement).style.display = 'flex';
      (liFunctionElements[i].children[0] as HTMLElement).style.justifyContent =
        'center';
      (
        liFunctionElements[i].children[0].children[1] as HTMLElement
      ).style.position = 'absolute';
    }

    // Mouse listener that determines values of hoveredCell and swappedCell
    canvas.addEventListener('mousemove', (event) => {
      const currWidth = canvas.getBoundingClientRect().width;
      const currHeight = canvas.getBoundingClientRect().height;
      const cellSize: [number, number] = [
        currWidth / settings['Grid Width'],
        currHeight / settings['Grid Height'],
      ];
      const xIndex = Math.floor(event.offsetX / cellSize[0]);
      const yIndex =
        settings['Grid Height'] - 1 - Math.floor(event.offsetY / cellSize[1]);
      hoveredCellController.setValue(yIndex * settings['Grid Width'] + xIndex);
      settings['Hovered Cell'] = yIndex * settings['Grid Width'] + xIndex;
    });

    // Deactivate interaction with select GUI elements
    sizeLimitController.domElement.style.pointerEvents = 'none';
    workgroupsPerStepController.domElement.style.pointerEvents = 'none';
    hoveredCellController.domElement.style.pointerEvents = 'none';
    swappedCellController.domElement.style.pointerEvents = 'none';
    currentStepController.domElement.style.pointerEvents = 'none';
    prevStepController.domElement.style.pointerEvents = 'none';
    prevBlockHeightController.domElement.style.pointerEvents = 'none';
    nextStepController.domElement.style.pointerEvents = 'none';
    nextBlockHeightController.domElement.style.pointerEvents = 'none';
    workgroupSizeController.domElement.style.pointerEvents = 'none';
    gridDimensionsController.domElement.style.pointerEvents = 'none';
    totalSwapsController.domElement.style.pointerEvents = 'none';
    gui.width = 325;

    let highestBlockHeight = 2;

    startSortInterval();

    async function frame() {
      if (!pageState.active) return;

      // Write elements buffer
      device.queue.writeBuffer(
        elementsInputBuffer,
        0,
        elements.buffer,
        elements.byteOffset,
        elements.byteLength
      );

      const dims = new Float32Array([
        settings['Grid Width'],
        settings['Grid Height'],
      ]);
      const stepDetails = new Uint32Array([
        StepEnum[settings['Next Step']],
        settings['Next Swap Span'],
      ]);
      device.queue.writeBuffer(
        computeUniformsBuffer,
        0,
        dims.buffer,
        dims.byteOffset,
        dims.byteLength
      );

      device.queue.writeBuffer(computeUniformsBuffer, 8, stepDetails);

      renderPassDescriptor.colorAttachments[0].view = context
        .getCurrentTexture()
        .createView();

      const commandEncoder = device.createCommandEncoder();
      bitonicDisplayRenderer.startRun(commandEncoder, {
        highlight: settings['Display Mode'] === 'Elements' ? 0 : 1,
      });
      if (
        settings.executeStep &&
        highestBlockHeight !== settings['Total Elements'] * 2
      ) {
        const computePassEncoder = commandEncoder.beginComputePass();
        computePassEncoder.setPipeline(computePipeline);
        computePassEncoder.setBindGroup(0, computeBGCluster.bindGroups[0]);
        computePassEncoder.dispatchWorkgroups(settings['Workgroups Per Step']);
        computePassEncoder.end();
        settings['Step Index'] = settings['Step Index'] + 1;
        currentStepController.setValue(
          `${settings['Step Index']} of ${settings['Total Steps']}`
        );
        prevStepController.setValue(settings['Next Step']);
        prevBlockHeightController.setValue(settings['Next Swap Span']);
        nextBlockHeightController.setValue(settings['Next Swap Span'] / 2);
        // Each cycle of a bitonic sort contains a flip operation followed by multiple disperse operations
        // Next Swap Span will equal one when the sort needs to begin a new cycle of flip and disperse operations
        if (settings['Next Swap Span'] === 1) {
          // The next cycle's flip operation will have a maximum swap span 2 times that of the previous cycle
          highestBlockHeight *= 2;
          if (highestBlockHeight === settings['Total Elements'] * 2) {
            // The next cycle's maximum swap span exceeds the total number of elements. Thus, the sort is over.
            nextStepController.setValue('NONE');
            nextBlockHeightController.setValue(0);
          } else if (highestBlockHeight > settings['Workgroup Size'] * 2) {
            // The next cycle's maximum swap span exceeds the range of a single workgroup, so our next flip will operate on global indices.
            nextStepController.setValue('FLIP_GLOBAL');
            nextBlockHeightController.setValue(highestBlockHeight);
          } else {
            // The next cycle's maximum swap span can be executed on a range of indices local to the workgroup.
            nextStepController.setValue('FLIP_LOCAL');
            nextBlockHeightController.setValue(highestBlockHeight);
          }
        } else {
          // Otherwise, execute the next disperse operation
          settings['Next Swap Span'] > settings['Workgroup Size'] * 2
            ? nextStepController.setValue('DISPERSE_GLOBAL')
            : nextStepController.setValue('DISPERSE_LOCAL');
        }

        // Copy GPU accessible buffers to CPU accessible buffers
        commandEncoder.copyBufferToBuffer(
          elementsOutputBuffer,
          0,
          elementsStagingBuffer,
          0,
          elementsBufferSize
        );

        commandEncoder.copyBufferToBuffer(
          atomicSwapsOutputBuffer,
          0,
          atomicSwapsStagingBuffer,
          0,
          Uint32Array.BYTES_PER_ELEMENT
        );
      }
      device.queue.submit([commandEncoder.finish()]);

      if (settings.executeStep) {
        // Copy GPU element data to CPU
        await elementsStagingBuffer.mapAsync(
          GPUMapMode.READ,
          0,
          elementsBufferSize
        );
        const copyElementsBuffer = elementsStagingBuffer.getMappedRange(
          0,
          elementsBufferSize
        );
        // Copy atomic swaps data to CPU
        await atomicSwapsStagingBuffer.mapAsync(
          GPUMapMode.READ,
          0,
          Uint32Array.BYTES_PER_ELEMENT
        );
        const copySwapsBuffer = atomicSwapsStagingBuffer.getMappedRange(
          0,
          Uint32Array.BYTES_PER_ELEMENT
        );
        // Get correct range of data from CPU copy of GPU Data
        const elementsData = copyElementsBuffer.slice(
          0,
          Uint32Array.BYTES_PER_ELEMENT * settings['Total Elements']
        );
        const swapsData = copySwapsBuffer.slice(
          0,
          Uint32Array.BYTES_PER_ELEMENT
        );
        // Extract data
        const elementsOutput = new Uint32Array(elementsData);
        totalSwapsController.setValue(new Uint32Array(swapsData)[0]);
        elementsStagingBuffer.unmap();
        atomicSwapsStagingBuffer.unmap();
        // Elements output becomes elements input, swap accumulate
        elements = elementsOutput;
        setSwappedCell();
      }
      settings.executeStep = false;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
).then((resultInit) => (init = resultInit));

const bitonicSortExample: () => JSX.Element = () =>
  makeSample({
    name: 'Bitonic Sort',
    description:
      "A naive bitonic sort algorithm executed on the GPU, based on tgfrerer's implementation at poniesandlight.co.uk/reflect/bitonic_merge_sort/. Each dispatch of the bitonic sort shader dispatches a workgroup containing elements/2 invocations. The GUI's Execution Information folder contains information about the sort's current state. The visualizer displays the sort's results as colored cells sorted from brightest to darkest.",
    init,
    gui: true,
    sources: [
      {
        name: __filename.substring(__dirname.length + 1),
        contents: __SOURCE__,
      },
      BitonicDisplayRenderer.sourceInfo,
      {
        name: '../../../shaders/fullscreenTexturedQuad.vert.wgsl',
        contents: fullscreenTexturedQuad,
      },
      {
        name: './bitonicDisplay.frag.wgsl',
        contents: bitonicDisplay,
      },
      {
        name: './bitonicCompute.ts',
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        contents: require('!!raw-loader!./bitonicCompute.ts').default,
      },
      {
        name: './atomicToZero.wgsl',
        contents: atomicToZero,
      },
    ],
    filename: __filename,
  });

export default bitonicSortExample;
