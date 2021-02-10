((API) => {
	'use strict';
	
	const contextableFunctionsModel = {
		beginFormObject: [1],
		circle: [1],
		curveTo: [1, 1, 1],
		ellipse: [1, 1],
		line: [1, 1],
		lines: [1, 1],
		lineTo: [1],
		moveTo: [1],
		rect: [1],
		roundedRect: [1,,, 1],
		text: [, 1],
		triangle: [1, 1, 1],

		createContextGenerator: []
	};

	API.registerContextableFunction  = function(name, model) {
		if(contextableFunctionsModel[name]) {
			console.error(`Context function "${name}" already exist.`);
			return false;
		}

		contextableFunctionsModel[name] = model;
		return true;
	};

	const contextableStates = {
		'CharSpace': null,
		'DrawColor': null,
		'FillColor': null,
		'Font': {
			set: (obj) => ([obj.fontName,obj.fontStyle,obj.fontWeight]),
			get: (arr) => ({fontName:arr[0],fontStyle:arr[1],fontWeight:arr[2]})
		},
		'FontSize': null,
		'LineHeightFactor': null,
		'TextColor': null
	};

	API.registerContextableState = function(name, setters) {
		if(typeof contextStates.name === 'undefined') {
			contextStates[name] = setters;
		}
	};

	const applyContextProperties = function(contextStates) {
		const context = this;
		const pdfContext = this.pdfContext();

		const currentPageNumber = pdfContext.getCurrentPageInfo().pageNumber;
		while(pdfContext.getNumberOfPages() < context.pageNumber()) pdfContext.addPage();
		pdfContext.setPage(context.pageNumber());

		const currentPageContextableStates = Object.keys(contextableStates).reduce((acc, key) => {
			const pdfValue = pdfContext['get' + key]();
			const contextValue = context['get' + key]();
			if(pdfValue !== contextValue) {
				acc[key] = pdfValue;
				if(contextableStates[key]) pdfContext['set' + key](...contextableStates[key].set(contextValue));
				else pdfContext['set' + key](contextValue);
			}
			return acc;
		}, {});

		return () => {
			pdfContext.setPage(currentPageNumber);
			console.log('!setPage', currentPageNumber);

			Object.keys(currentPageContextableStates).forEach(key => {
				const value = currentPageContextableStates[key];
				if(contextableStates[key]) pdfContext['set' + key](...contextableStates[key].set(value));
				else pdfContext['set' + key](value);
			});
		};
	};

	API.contextGenerators = (() => ({
		columns: function(number, options) {
			options = options || {};
			options.offsetLeft = options.offsetLeft || 0;
			options.offsetTop = options.offsetTop || 0;
			options.offsetPage = options.offsetPage || 0;
			options.margin = options.margin || 0;
			options.padding = options.padding || 0;
	
			return function(id0) {
				const parentContext = this;
				const pdfContext = parentContext.pdfContext();
	
				const pageNumber = Math.floor(id0/number) + options.offsetPage + parentContext.pageNumber();
				if(!options.width && !options.height) {
					while(pdfContext.getNumberOfPages() < pageNumber) pdfContext.addPage();
				}
				const width = options.width || (pdfContext.getPageWidth(pageNumber)-parentContext.contextLeft()-options.offsetLeft-options.margin*(number-1))/number;
	
				return {
					pageNumber,
					x: parentContext.contextLeft() + options.offsetLeft + (id0%number)*(width+options.margin),
					y: parentContext.contextTop() + options.offsetTop,
					width,
					height: options.height || (pdfContext.getPageHeight(pageNumber)-parentContext.contextTop()-options.offsetTop)
				};
			};
		},
		accordions: function(number, options) {
			const columnsGenerator = this.columns(number, options);

			return function(id0) {
				const parentContext = this;
				const pdfContext = parentContext.pdfContext();

				const context = columnsGenerator.call(parentContext, id0);
				const EVEN_NB = id0%2;
				const floor = Math.floor(id0/2);
				context.pageNumber = Math.floor(id0/(2*number))*2 + EVEN_NB + options.offsetPage + parentContext.pageNumber();
				if(!options.width && !options.height) {
					while(pdfContext.getNumberOfPages() < context.pageNumber) pdfContext.addPage();
				}
				context.x = ((floor%number + EVEN_NB)*(context.width+options.margin) + options.offsetLeft)*(EVEN_NB? -1 : 1) + EVEN_NB*(pdfContext.getPageWidth(context.pageNumber)+options.margin);

				return context;
			};
		}
	}))();
	
	const createContext = API.createContext = function(x, y, pageOffset, options) {
		options = options || {};
		const parentContext = this;
		const pdfContext = parentContext.pdfContext? parentContext.pdfContext() : parentContext;

		const context = {
			level: () => ((parentContext.level? parentContext.level() : 0) + 1),
			pdfContext: () => pdfContext,
			parentContext: () => parentContext,
			pageNumber: () => (parentContext.pageNumber? parentContext.pageNumber() : 1) + (pageOffset || 0),
			contextLeft: () => (parentContext.contextLeft? parentContext.contextLeft() : 0) + (x || 0),
			contextTop: () => (parentContext.contextTop? parentContext.contextTop() : 0) + (y || 0),
			createContext,
			createContextFromGenerator
		};
		context.firstLevelContext = () => (parentContext.firstLevelContext? parentContext.firstLevelContext() : context);
		context.contextWidth = () => options.width || (parentContext.contextWidth? parentContext.contextWidth() : pdfContext.getPageWidth(context.pageNumber())) - (x || 0);
		context.contextHeight = () => options.height || (parentContext.contextHeight? parentContext.contextHeight() : pdfContext.getPageHeight(context.pageNumber())) - (y || 0);
		context.contextRight = () => context.contextLeft() + context.contextWidth();
		context.contextBottom = () => context.contextTop() + context.contextHeight();
		
		const contextStates = {};
		Object.keys(contextableStates).forEach(key => {
			context['set' + key] = (...values) => contextStates[key] = contextableStates[key]? values : values[0];
			context['get' + key] = () => (contextStates[key] && contextableStates[key] && contextableStates[key].get(contextStates[key])) ||
				contextStates[key] || parentContext['get' + key]();
		});

		Object.keys(contextableFunctionsModel).forEach(key => {
			const model = contextableFunctionsModel[key];

			context[key] = (...params) => {
				for(let modelPos = 0, paramPos = 0; modelPos < model.length; modelPos++, paramPos++) {
					if(model[modelPos]) {
						params[paramPos] += context.contextLeft();
						params[paramPos+1] += context.contextTop();
						paramPos++;
					}
				}

				const restore = applyContextProperties.call(context, contextStates);
				const result = context.pdfContext()[key](...params);
				restore();
				return result;
			};
		});

		return context;
	};

	const createContextFromGenerator = API.createContextFromGenerator = function(generator, pageOffset) {
		const parentContext = this;
		
		const generatorContext = parentContext.createContext(0, 0, pageOffset);
		generatorContext.get = function(id) {
			const parentContext = this;

			const generatorResult = generator.call(parentContext, id-1);
			const context = parentContext.createContext(generatorResult.x, generatorResult.y, (generatorResult.pageNumber-1), {
				width: generatorResult.width,
				height: generatorResult.height
			});
			context.first = () => generatorContext.get(1);
			context.next = count => generatorContext.get(id + (count || 1));
			context.previous = count => generatorContext.get(id - (count || 1));
			context.contextId = () => id;
			context.custom = () => generatorResult.custom || {};

			return context;
		};
		generatorContext.first = () => generatorContext.get(1);

		return generatorContext;
	};
})(jspdf.jsPDF.API);
