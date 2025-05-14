// JavaScript implementation of css-view-transitions-1 (May 2, 2025 Snapshot)
// (https://drafts.csswg.org/css-view-transitions-1/)
//
// Licensed under the MIT License – https://opensource.org/license/mit
// Copyright (c) 2025 Bramus
//
// ⚠️ DO NOT USE THIS IN PRODUCTION. THIS IS AN EXPERIMENT, NOT A POLYFILL.
// 
// See https://github.com/bramus/view-transitions-js for details

// 📕 CONFIG

// Set to true to log which steps are being executed
const debug = false;

// This object configures what to snapshot as part of the old and new states.
// It is to be used whenever the spec reads “For each element of every element
// that is connected, and has a node document equal to document, in paint order”
//
// This is typically determined through CSS, but since we can’t know which
// elements have a specific viewTransitionName set (unless we loop all nodes),
// we use this config instead.
//
// This config needs to be declared in such a way that they are listed in
// revserse paint-order (so from top-most to bottom),
// something we also can’t determine through script.
// 
// The elements are turned by a function because these need to be read
// when needed.
const snapshotConfig = {
	old: [
		() => document.querySelector(".box"),
		// () => document.documentElement,
	],
	new: [
		() => document.querySelector(".box"),
		// () => document.documentElement,
	],
};

// 📕 UTILS

// Utility function to easily create an element
const createElement = (tagName, options = null) => {
	const { children, data, ...rest } = options ?? {};

	const $el = Object.assign(document.createElement(tagName), rest);

	// data-*
	if (data) {
		for (const [key, value] of Object.entries(data)) {
			$el.dataset[key] = value;
		}
	}

	// Append children
	if (children) {
		for (const $child of children) {
			if ($child instanceof HTMLElement) {
				$el.appendChild($child);
			}
		}
	}

	return $el;
};

// Utiltily function to create a CSSStyleRule
// @TODO: This needs some safeguards to be built-in
const createCSSStyleRule = (css) => {
	const stylesheet = new CSSStyleSheet();
	stylesheet.replaceSync(css);
	return stylesheet.cssRules[0];
}

// Utiltily function to create a CSSKeyframeRule
// @TODO: This needs some safeguards to be built-in
const createCSSKeyframeRule = (css) => {
	const stylesheet = new CSSStyleSheet();
	stylesheet.replaceSync(css);
	return stylesheet.cssRules[0];
}

// CSSStyleSheet that has a hasRule()
class EasierToWorkWithCSSStyleSheet {
	#styleSheet = new CSSStyleSheet();
	#rules = [];
	
	insertRule(/* CSSStyleRule */ rule) {
		this.#rules.push(rule);
		this.#styleSheet.insertRule(rule.cssText, this.#rules.length-1);
	}
	
	hasRule(/* CSSStyleRule */ rule) {
		return this.#rules.includes(rule);
	}
	
	deleteRule(/* CSSStyleRule */ rule) {
		const index = this.#rules.indexOf(rule);

		if (index !== -1) {
			this.#styleSheet.deleteRule(index);
			this.#rules.splice(index, 1);
		}
	}
	
	get styleSheet() {
		return this.#styleSheet;
	}
}

// A Watchable Promise that you can read the status from,
// modded to also expose the resolvers.
// @ref https://stackoverflow.com/a/76838887/2076595
class WatchablePromise extends Promise {
  #settled = false;
  #status = "pending";
	
	#resolve = null;
	#reject = null;

  constructor(executor) {
		let _resolve, _reject;
		
    super((resolve, reject) => {
			_resolve = (value) => {
				resolve(value);
				this.#settled = true;
				this.#status = "fulfilled";
			};
			_reject = (reason) => {
				reject(reason);
				this.#settled = true;
				this.#status = "rejected";
			};
      executor(_resolve, _reject);
    });
		
		this.#resolve = _resolve;
		this.#reject = _reject;
  }

  get settled() {
    return this.#settled;
  }

  get status() {
    return this.#status;
  }
	
	resolve() {
		this.#resolve();
	}
	
	reject() {
		this.#reject();
	}
}

// 📕 ACTUAL css-view-transitions-1 IMPLEMENTATTION

// This stores the Snapshot Containing Block Size
// @TODO: Setup resize/orientationchange listeners to update these values
const snapshotContainingBlockSize = {
	width: window.innerWidth,
	height: window.innerHeight,
};

// @TODO: Implement https://drafts.csswg.org/css-view-transitions-1/#page-visibility-change-steps

// ## Additions to Document
// @ref https://drafts.csswg.org/css-view-transitions-1/#additions-to-document

// active view transition – a ViewTransition or null. Initially null.
// @NOTE: This is non-spec compliant behavior here, because activeViewTransition
// is not publicly exposed on Document, but perhaps it should …
document.activeViewTransition = null;

// rendering suppression for view transitions – a boolean. Initially false.
// While a Document’s rendering suppression for view transitions is true, all pointer hit testing must target its document element, ignoring all other elements.
// @TODO: Try and implement this by snapshotting the page before the VT runs
// or, alternatively, figure out something else, such as hiding the elements participating in VT.
// This could possibly be checked on [data-captured-in-a-view-transition]
// @TODO: Do the hit testing thing
// @TODO: Probably I need to implement it so that we don’t directly manipulate this var but do it in a function that does more than simply changing the value
renderingSuppression = false;

// dynamic view transition style sheet - a style sheet. Initially a new style sheet in the user-agent origin, ordered after the global view transition user agent style sheet.
viewTransitionStyleSheet = new EasierToWorkWithCSSStyleSheet();
document.adoptedStyleSheets = [viewTransitionStyleSheet.styleSheet, ...document.adoptedStyleSheets];

// show view transition tree – A boolean. Initially false.
showViewTransitionTree = false;

// We introduce this setter because we also need to be able to respond to showViewTransitionTree changing.
const setShowViewTransitionTree = (value) => {
	showViewTransitionTree = value;
	
	if (showViewTransitionTree) {
		document.documentElement.appendChild(document.activeViewTransition.transitionRoot);
	} else {
		if ([...document.documentElement.children].includes(document.activeViewTransition.transitionRoot)) {
			document.documentElement.removeChild(document.activeViewTransition.transitionRoot);
		}
	}
}

// update callback queue – A list, initially empty.
updateCallbackQueue = [];

// @ref https://drafts.csswg.org/css-view-transitions-1/#captured-elements
const capturedElementStruct = {
	oldImage: null,
	oldWidth: 0,
	oldHeight: 0,
	oldTransform: 'matrix(1, 0, 0, 1, 0, 0)',
	oldWritingMode: null,
	oldDirection: null,
	oldTextOrientation: null,
	oldMixBlendMode: null,
	oldBackdropFilter: null,
	oldColorScheme: null,
	newElement: null,
	newImage: null, // Non-spec compliant, because we need to store a screenshot
	styleDefinitions: {
		groupKeyframes: null,
		groupAnimationNameRule: null,
		groupStylesRule: null,
		imagePareIsolationRule: null,
		imageAnimationNameRule: null,
	},
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#viewtransition-phase
const phases = [
	'pending-capture',
	'update-callback-called',
	'animating',
	'done',
]

// @ref https://drafts.csswg.org/css-view-transitions-1/#the-domtransition-interface
class ViewTransition {
	// named elements – a map, whose keys are view transition names and whose values are captured elements. Initially a new map.
	#namedElements = new Map();
	
	// phase – One of the following ordered phases, initially "pending-capture"
	#phase = phases[0];
	
	// update callback – a ViewTransitionUpdateCallback or null. Initially null.
	#updateCallback = null;

	// ready promise – A Promise. Initially a new promise in this’s relevant Realm.
	#ready = new WatchablePromise((resolve, reject) => {});
	
	// update callback done promise – a Promise. Initially a new promise in this’s relevant Realm.
	#updateCallbackDone = new WatchablePromise((resolve, reject) => {});
	
	// finished promise – a Promise. Initially a new promise in this’s relevant Realm, marked as handled.
	#finished = new WatchablePromise((resolve, reject) => {});
	
	// transition root pseudo-element – a ::view-transition. Initially a new ::view-transition.
	transitionRoot = createElement('div', {
		data: { pseudo: '::view-transition' },
	});

	// initial snapshot containing block size – a tuple of two numbers (width and height), or null. Initially null.
	initialSnapshotContainingBlockSize = null;
	
	// The finished getter steps are to return this’s finished promise.
	get finished() {
		return this.#finished;
	}
	
	// The ready getter steps are to return this’s ready promise.
	get ready() {
		return this.#ready;
	}
	
	// The updateCallbackDone getter steps are to return this’s update callback done promise.
	get updateCallbackDone() {
		return this.#updateCallbackDone;
	}
	
	set updateCallback(updateCallback) {
		this.#updateCallback = updateCallback;
	}
	
	get updateCallback() {
		return this.#updateCallback;
	}
	
	set phase(phase) {
		if (!phases.includes(phase)) {
			throw new Error('Invalid phase');
		}
		
		this.#phase = phase;
	}
	
	get phase() {
		return this.#phase;
	}
	
	get namedElements() {
		return this.#namedElements;
	}
	
	// @ref https://drafts.csswg.org/css-view-transitions-1/#ViewTransition-skipTransition
	skipTransition = () => {
		// 1. If this’s phase is not "done", then skip the view transition for this with an "AbortError" DOMException.
		if (this.#phase !== 'done') {
			skipTheViewTransition(this, 'AbortError');
		}
	};
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#ViewTransition-prepare
document.startViewTransition = (updateCallback) => {
	debug && console.log('startViewTransition');
	// 1. Let transition be a new ViewTransition object in this’s relevant Realm.
	// @TODO: “in this’s relevant Realm”
	// @TODO: Rename the class to ViewTransition
	const transition = new ViewTransition();

	// 2. If updateCallback is provided, set transition’s update callback to updateCallback.
	if (updateCallback) {
		transition.updateCallback = updateCallback;
	}

	// 3. Let document be this’s relevant global object’s associated document.
	// @TODO

	// 4. If document’s visibility state is "hidden", then skip transition with an "InvalidStateError" DOMException, and return transition.
	// @TODO: Check if calling skipTransition actually allows returning the transition afterwards
	if (document.visibilityState === "hidden") {
		transition.skipTransition("InvalidStateError");
		return transition;
	}

	// 5. If document’s active view transition is not null, then skip that view transition with an "AbortError" DOMException in this’s relevant Realm.
	if (document.activeViewTransition != null) {
		document.activeViewTransition.skipTransition("AbortError");
	}

	// 6. Set document’s active view transition to transition.
	// NOTE: The view transition process continues in setup view transition, via perform pending transition operations.
	document.activeViewTransition = transition;
	window.queueMicrotask(performPendingOperations);

	// 7. Return transition.
	return transition;
};

// @ref https://drafts.csswg.org/css-view-transitions-1/#skip-the-view-transition
const skipTheViewTransition = (transition, reason) => {
	debug && console.log('skipTheViewTransition');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @TODO

	// 2. Assert: transition’s phase is not "done".
	if (transition.phase === "done") {
		throw new Error('Assertion failed: transition’s phase is not "done"');
	}

	// 3. If transition’s phase is before "update-callback-called", then schedule the update callback for transition.
	if (phases.indexOf(transition.phase) < phases.indexOf("update-callback-called")) {
		scheduleTheUpdateCallback(this);
	};

	// 4. Set rendering suppression for view transitions to false.
	renderingSuppression = false;

	// 5. If document’s active view transition is transition, Clear view transition transition.
	if (document.activeViewTransition === transition) {
		clearViewTransition(transition);
	}

	// 6. Set transition’s phase to "done".
	transition.phase = 'done';

	// 7. Reject transition’s ready promise with reason.
	// @TODO: There is a note in the spec that reads:
	// 
	// > The ready promise may already be resolved at this point,
	// > if skipTransition() is called after we start animating.
	// > In that case, this step is a no-op.
	// 
	// Do we need to check first?
	transition.ready.reject(reason);

	// 8. Resolve transition’s finished promise with the result of reacting to transition’s update callback done promise
	//   - If the promise was fulfilled, then return undefined.
	// 
	// @TODO: Figure out if I did this “reacting” thing right – https://webidl.spec.whatwg.org/#dfn-perform-steps-once-promise-is-settled
	// @TODO: Which promise is “the promise”? The finished one or the updateCallbackDone one?
	// @TODO: Monitor https://github.com/w3c/csswg-drafts/issues/11990
	const updateCallbackDoneResult = transition.updateCallbackDone.resolve();

	if (transition.updateCallbackDone.status === 'fulfilled') {
		transition.finished.resolve(updateCallbackDoneResult);
	} else {
		transition.finished.reject();
	}

	// @TODO: Do we need to return something else when it is not fullfilled?
	if (transition.finished.status === 'fulfilled') return undefined;
};

// @ref https://drafts.csswg.org/css-view-transitions-1/#perform-pending-transition-operations-algorithm
const performPendingOperations = async () => {
	debug && console.log('performPendingOperations');
	// 1. If document’s active view transition is not null, then:
	if (document.activeViewTransition) {
		// 1.1. If document’s active view transition’s phase is "pending-capture", then setup view transition for document’s active view transition.
		if (document.activeViewTransition.phase === 'pending-capture') {
			await setupViewTransition(document.activeViewTransition);
		}
	
		// 1.2 Otherwise, if document’s active view transition’s phase is "animating", then handle transition frame for document’s active view transition.
		if (document.activeViewTransition.phase === 'animating') {
			// @TODO: I think we can diverge from the spec here and replace the call to handleTransitionFrame
			// by a callback that awaits for Promise.allSettled(allAnimations.map(a => a.finished)).
			// When doing so, we could return early here, bypassing the rAF below.
			// 
			// However, for this to work correctly it would also require a window.resize listener to
			// make sure the activeViewTransition gets skipped when the VP (and thus SCB changes)
			// This check is also part of handleTransitionFrame.
			handleTransitionFrame(document.activeViewTransition);
		}
		
		// @NOTE: The spec says performPendingOperations should be implemented
		// as part of the of the “update the rendering loop” from the html spec.
		// To fake this, We need to do this non-spec compliant call here,
		// to make sure performPendingOperations runs at the next frame.
	  requestAnimationFrame(performPendingOperations);
	}
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#setup-view-transition-algorithm instead
const setupViewTransition = async (transition) => {
	debug && console.log('setupViewTransition');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @TODO
	
	// 2. Flush the update callback queue.
	flushTheUpdateCallbackQueue();

	// 3. Capture the old state for transition.
	// If failure is returned, then skip the view transition for transition with an "InvalidStateError" DOMException
	// in transition’s relevant Realm, and return.
	const oldState = await captureTheOldState(transition);
	if (oldState === 'FAILURE') {
		transition.skipTransition('InvalidStateError');
		return;
	}
	
	// 4. Set document’s rendering suppression for view transitions to true.
	renderingSuppression = true;
	
	// 5. Queue a global task on the DOM manipulation task source, given transition’s relevant global object,
	// to perform the following steps:
	// @TODO: Monitor https://github.com/w3c/csswg-drafts/issues/11987
	// because here-queued scheduleTheUpdateCallback includes a call to flushTheUpdateCallbackQueue
	// and step 3 here also does a flushTheUpdateCallbackQueue
	queueMicrotask(() => {
		// 1. If transition’s phase is "done", then abort these steps.
		if (transition.phase === 'done') return;
		
		// 2. schedule the update callback for transition.
		scheduleTheUpdateCallback(transition);
		
		// 3. Flush the update callback queue.
		flushTheUpdateCallbackQueue();
	});
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#schedule-the-update-callback
const scheduleTheUpdateCallback = (transition) => {
	debug && console.log('scheduleTheUpdateCallback');
	// 1. Append transition to transition’s relevant settings object’s update callback queue.
	// @TODO: What is “relevant settings object”?
	// @TODO: Monitor https://github.com/w3c/csswg-drafts/issues/11986
	updateCallbackQueue.push(transition);
	
	// 2. Queue a global task on the DOM manipulation task source, given transition’s relevant global object, to flush the update callback queue.
	queueMicrotask(flushTheUpdateCallbackQueue);
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#handle-transition-frame
const handleTransitionFrame = (transition) => {
	debug && console.log('handleTransitionFrame');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @NOOP
	
	// 2. Let hasActiveAnimations be a boolean, initially false.
	let hasActiveAnimations = false;
	
	// 3. For each element of transition’s transition root pseudo-element’s inclusive descendants:
	const inclusiveDescants = [...transition.transitionRoot.querySelectorAll(":scope *")];
	inclusiveDescantsLoop:
	for (const element of inclusiveDescants) {
		const animations = element.getAnimations();
		// 3.1 For each animation whose timeline is a document timeline associated with document,
		// and contains at least one associated effect whose effect target is element,
		// set hasActiveAnimations to true if any of the following conditions are true:
		// - animation’s play state is paused or running.
		// - document’s pending animation event queue has any events associated with animation.
		for (const animation of animations) {
			if ((animation.playState === 'pause') ||  (animation.playState === 'running')) {
				hasActiveAnimations = true;
				break inclusiveDescantsLoop;
			}
		}
	}
	
	// 4. If hasActiveAnimations is false:
	if (hasActiveAnimations === false) {
		// 4.1 Set transition’s phase to "done".
		transition.phase = 'done';

		// 4.2 Clear view transition transition.
		clearViewTransition(transition);

		// 4.3 Resolve transition’s finished promise.
		transition.finished.resolve();

		// 4.4 Return.
		return;
	}
	
	// 5. If transition’s initial snapshot containing block size is not equal to the snapshot containing block size,
	// then skip the view transition for transition with an "InvalidStateError" DOMException in transition’s relevant Realm, and return.
	if (
		(!transition.initialSnapshotContainingBlockSize) ||
		(transition.initialSnapshotContainingBlockSize.width !== snapshotContainingBlockSize.width) || 
		(transition.initialSnapshotContainingBlockSize.height !== snapshotContainingBlockSize.height)
	) {
		skipTheViewTransition(transition, 'InvalidStateError');
		return;
	}
	
	// debugger;
	
	// 6. Update pseudo-element styles for transition.
	// If failure is returned, then skip the view transition for transition with an "InvalidStateError" DOMException in transition’s relevant Realm, and return.
	//
	// @NOTE: I disabled this step because it results in updatePseudoElementStyles getting called at every 
	// frame while a VT is running.
	// 
	// performPendingOperations -> handleTransitionFrame -> updatePseudoElementStyles
	// 
	// I think disabling this step is safe to do because updatePseudoElementStyles
	// was already called as part of activateViewTransition.
	// 
	// @TODO: File a spec issue about this. #SPECISSUE
	// 
	// const updated = updatePseudoElementStyles(transition);
	// if (updated === 'FAILURE') {
	// 	skipTheViewTransition(transition, 'InvalidStateError');
	// 	return;
	// }
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#clear-view-transition
const clearViewTransition = (transition) => {
	debug && console.log('clearViewTransition');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @NOOP
	
	// 2. Assert: document’s active view transition is transition.
	if (transition !== document.activeViewTransition) {
		throw new Error('Assertion failed: transition !== document.activeViewTransition');
	}
	
	// 3. For each capturedElement of transition’s named elements' values:
	transition.namedElements.forEach((capturedElement, transitionName) => {
		// 1. If capturedElement’s new element is not null, then set capturedElement’s new element’s captured in a view transition to false.
		if (capturedElement.newElement !== null) {
			delete capturedElement.newElement.dataset.capturedInAViewTransition;
		}
		
		// 2. For each style of capturedElement’s style definitions:
		Object.entries(capturedElement.styleDefinitions).forEach((key, style) => {
			// 1. If style is not null, and style is in document’s dynamic view transition style sheet, then remove style from document’s dynamic view transition style sheet.
			if ((style !== null) && (viewTransitionStyleSheet.hasRule(style))) {
				viewTransitionStyleSheet.deleteRule(style);
			}
		});
	});
	
	// 4. Set document’s show view transition tree to false.
	setShowViewTransitionTree(false);
	
	// 5. Set document’s active view transition to null.
	document.activeViewTransition = null;
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#flush-the-update-callback-queue
//
// @TODO: Monitor https://github.com/w3c/csswg-drafts/issues/11986
// This function takes a document but it doesn’t really do anything
const flushTheUpdateCallbackQueue = (document) => {
	debug && console.log('flushTheUpdateCallbackQueue');
	// 1. For each transition in document’s update callback queue, call the update callback given transition.
	// @TODO: Should we try-catch this?
	for (const transition of updateCallbackQueue) {
		callTheUpdateCallback(transition);
	}
	
	// 2. Set document’s update callback queue to an empty list.
	updateCallbackQueue = [];
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#call-the-update-callback
const callTheUpdateCallback = (transition) => {
	debug && console.log('callTheUpdateCallback');
	// 1. Assert: transition’s phase is "done", or before "update-callback-called".
	if (!((transition.phase === 'done') || (phases.indexOf(transition.phase) < phases.indexOf('update-callback-called')))) {
		throw new Error('Assertion failed: transition’s phase is "done", or before "update-callback-called".')
	}
	
	// 2. If transition’s phase is not "done", then set transition’s phase to "update-callback-called".
	if (transition.phase !== 'done') {
		transition.phase = 'update-callback-called';
	}
	
	// 3. Let callbackPromise be null.
	let callbackPromise = null;
	
	// 4. If transition’s update callback is null, then set callbackPromise to a promise resolved with undefined, in transition’s relevant Realm.
	if (transition.updateCallback === null) {
		callbackPromise = new WatchablePromise((resolve, reject) => { });
		callbackPromise.resolve(undefined);
	}
	
	// 5. Otherwise, set callbackPromise to the result of invoking transition’s update callback.
	// @TODO: I wrapped this in Promise.resolve … is that correct? If so, spec needs updating.
	else {
		callbackPromise = new WatchablePromise((resolve, reject) => { });
		callbackPromise.resolve(transition.updateCallback());
	}
	
	// 6. Let fulfillSteps be the following steps:
	let fulfillSteps = async () => {
		// 1. Resolve transition’s update callback done promise with undefined.
		transition.updateCallbackDone.resolve();
		
		// 2. Activate transition.
		await activateViewTransition(transition);
	};
	
	// 7. Let rejectSteps be the following steps given reason:
	let rejectSteps = (reason) => {
		// 1. Reject transition’s update callback done promise with reason.	
		transition.updateCallbackDone.reject(reason);
		
		// 2. If transition’s phase is "done", then return.
		if (transition.phase === 'done') return;
		
		// 3. Mark as handled transition’s ready promise.
		// @ref: https://webidl.spec.whatwg.org/#mark-a-promise-as-handled
		// TODO: HOWTO? Given I don’t have access to that …
		
		// 4. Skip the view transition transition with reason.
		skipTheViewTransition(transition, reason);
	};
	
	// 8. React to callbackPromise with fulfillSteps and rejectSteps.
	// @TODO: Confirm I am reacting correctly – https://webidl.spec.whatwg.org/#dfn-perform-steps-once-promise-is-settled
	// @TODO: Monitor https://github.com/w3c/csswg-drafts/issues/11990
	if (callbackPromise.status === 'fulfilled') {
		fulfillSteps();
	} else {
		rejectSteps();
	}
	
	// 9. To skip a transition after a timeout, the user agent may perform the following steps in parallel:
	// @TODO
	
		// 9.1. Wait for an implementation-defined duration.
		// @TODO
	
		// 9.2. Queue a global task on the DOM manipulation task source, given transition’s relevant global object, to perform the following steps:
		// @TODO
	
			// 9.2.1. If transition’s phase is "done", then return.
			// @TODO
	
			// 9.2.2. Skip transition with a "TimeoutError" DOMException.
			// @TODO
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#activate-view-transition
const activateViewTransition = async (transition) => {
	debug && console.log('activateViewTransition');
  // 1. If transition’s phase is "done", then return.
	if (transition.phase === 'done') return;
	
	// 2. Set transition’s relevant global object’s associated document’s rendering suppression for view transitions to false.
	renderingSuppression = false;
	
	// 3. If transition’s initial snapshot containing block size is not equal to the snapshot containing block size, then skip transition with an "InvalidStateError" DOMException in transition’s relevant Realm, and return.
	if (
		(!transition.initialSnapshotContainingBlockSize) ||
		(transition.initialSnapshotContainingBlockSize.width !== snapshotContainingBlockSize.width) || 
		(transition.initialSnapshotContainingBlockSize.height !== snapshotContainingBlockSize.height)
	) {
		skipTheViewTransition(transition, 'InvalidStateError');
		return;
	}
	
	// 4. Capture the new state for transition.
	// If failure is returned, then skip transition with an "InvalidStateError" DOMException in transition’s relevant Realm, and return.
	// debugger;
	const newState = await captureTheNewState(transition);
	if (newState === 'FAILURE') {
		skipTheViewTransition(transition, 'InvalidStateError');
		return;
	}
	
	// 5. For each capturedElement of transition’s named elements' values:
	transition.namedElements.forEach((capturedElement, transitionName) => {
		// If capturedElement’s new element is not null, then set capturedElement’s new element’s captured in a view transition to true.
		if (capturedElement.newElement !== null) {
			capturedElement.newElement.dataset.capturedInAViewTransition = true;
		}
	});
	
	// 6. Setup transition pseudo-elements for transition.
	setupTransitionPseudoElements(transition);
	
	// 7. Update pseudo-element styles for transition.
	// If failure is returned, then skip the view transition for transition with an "InvalidStateError" DOMException in transition’s relevant Realm, and return.
	const updated = updatePseudoElementStyles(transition);
	if (updated === 'FAILURE') {
		skipTheViewTransition(transition, 'InvalidStateError');
		return;
	}
	
	// 8. Set transition’s phase to "animating".
	transition.phase = 'animating';
	
	// 9. Resolve transition’s ready promise.
	transition.ready.resolve();
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#capture-the-old-state
const captureTheOldState = async (transition) => {
	debug && console.log('captureTheOldState');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @NOOP
	
	// 2. Let namedElements be transition’s named elements.
	let namedElements = transition.namedElements;
	
	// 3. Let usedTransitionNames be a new set of strings.
	const usedTransitionNames = new Set();
	
	// 4. Let captureElements be a new list of elements.
	const captureElements = [];
	
	// 5. If the snapshot containing block size exceeds an implementation-defined maximum, then return failure.
	// @NOOP
	
	// 6. Set transition’s initial snapshot containing block size to the snapshot containing block size.
	transition.initialSnapshotContainingBlockSize = structuredClone(snapshotContainingBlockSize);
	
	// 7. For each element of every element that is connected, and has a node document equal to document, in paint order:
	const elements = snapshotConfig.old.map(e => e());
	for (let element of elements) {
		// 7.1. If any flat tree ancestor of this element skips its contents, then continue.
		// @TODO: Walk the ancestor tree and do a visibilityCheck
		
		// 7.2. If element has more than one box fragment, then continue.
		// @NOOP
		
		// 7.3. Let transitionName be the element’s document-scoped view transition name.
		let transitionName = getComputedStyle(element).getPropertyValue('--view-transition-name');
		
		// 7.4. If transitionName is none, or element is not rendered, then continue.
		// @TODO: Is checkVisibility() OK here?
		// @TODO: What about older browsers?
		if ((transitionName === 'none') || !element.checkVisibility()) {
			continue;
		}

		// 7.5. If usedTransitionNames contains transitionName, then:
		if (usedTransitionNames.has(transitionName)) {
			// 7.5.1. For each element in captureElements:
			captureElements.forEach(element => {
				// 7.5.1.1 Set element’s captured in a view transition to false.
				delete element.dataset.capturedInAViewTransition;
			});
			
			// 7.5.2. return failure.
			return 'FAILURE';
		}
		
		// 7.6. Append transitionName to usedTransitionNames.
		usedTransitionNames.add(transitionName);
		
		// 7.7. Set element’s captured in a view transition to true.
		element.dataset.capturedInAViewTransition = true;
		
		// 7.8. Append element to captureElements.
		captureElements.push(element);
	};
	
	// 8. For each element in captureElements:
	for (let element of captureElements) {
		// 8.1 Let capture be a new captured element struct.
		let capture = structuredClone(capturedElementStruct);
		
		// 8.2 Set capture’s old image to the result of capturing the image of element.
		capture.oldImage = await captureTheImage(element);
		
		// 8.3. Let originalRect be snapshot containing block if element is the document element, otherwise, the element’s border box.
		let originalRect;
		if (element === document.documentElement) {
			originalRect = {
				width: snapshotContainingBlockSize.width,
				height: snapshotContainingBlockSize.height,
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				bottom: snapshotContainingBlockSize.height,
				right: snapshotContainingBlockSize.width,
			};
		} else {
			originalRect = element.getBoundingClientRect();
		}
		
		// 8.4 Set capture’s old width to originalRect’s width.
		capture.oldWidth = originalRect.width;
		
		// 8.5 Set capture’s old height to originalRect’s height.
		capture.oldHeight = originalRect.height;
		
		// 8.6 Set capture’s old transform to a <transform-function> that would map element’s border box from the snapshot containing block origin to its current visual position.
		// @TODO: Whenever the snapshot containing block can be added, its offset against the viewport must be taken into account
		capture.oldTransform = `matrix(1, 0, 0, 1, ${originalRect.x}, ${originalRect.y})`;
		
		// 8.7 Set capture’s old writing-mode to the computed value of writing-mode on element.
		capture.oldWritingMode = getComputedStyle(element).writingMode;
		
		// 8.8 Set capture’s old direction to the computed value of direction on element.
		capture.oldDirection = getComputedStyle(element).direction;
		
		// 8.9 Set capture’s old text-orientation to the computed value of text-orientation on element.
		capture.oldTextOrientation = getComputedStyle(element).textOrientation;
		
		// 8.10 Set capture’s old mix-blend-mode to the computed value of mix-blend-mode on element.
		capture.oldMixBlendMode = getComputedStyle(element).mixBlendMode;
		
		// 8.11 Set capture’s old backdrop-filter to the computed value of backdrop-filter on element.
		capture.oldBackdropFilter = getComputedStyle(element).backdropFilter;
		
		// 8.12 Set capture’s old color-scheme to the computed value of color-scheme on element.
		capture.oldColorScheme = getComputedStyle(element).colorScheme;
		
		// 8.13 Let transitionName be the computed value of view-transition-name for element.
		transitionName = getComputedStyle(element).getPropertyValue('--view-transition-name');
		
		// 8.14 Set namedElements[transitionName] to capture.
		namedElements.set(transitionName, capture);
	}
	
	// 9. For each element in captureElements
	captureElements.forEach(element => {
		// 1. Set element’s captured in a view transition to false.
		delete element.dataset.capturedInAViewTransition;
	});
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#capture-the-new-state
const captureTheNewState = async (transition) => {
	debug && console.log('captureTheNewState');
	// 1. Let document be transition’s relevant global object’s associated document.
	// @NOOP
	
	// 2. Let namedElements be transition’s named elements.
	let namedElements = transition.namedElements;
	
	// 3. Let usedTransitionNames be a new set of strings.
	const usedTransitionNames = new Set();
	
	// 4. For each element of every element that is connected, and has a node document equal to document, in paint order:
	const elements = snapshotConfig.new.map(e => e());
	for (let element of elements) {
		// 4.1 If any flat tree ancestor of this element skips its contents, then continue.
		// @TODO: Walk the ancestor tree and do a visibilityCheck
		
		// 4.2 Let transitionName be element’s document-scoped view transition name.
		let transitionName = getComputedStyle(element).getPropertyValue('--view-transition-name');

		// 4.3 If transitionName is none, or element is not rendered, then continue.
		// @TODO: Is checkVisibility() OK here?
		// @TODO: What about older browsers?
		if ((transitionName === 'none') || !element.checkVisibility()) {
			continue;
		}

		// 4.4 If element has more than one box fragment, then continue.
		// @NOOP

		// 4.5 If usedTransitionNames contains transitionName, then return failure.
		if (usedTransitionNames.has(transitionName)) return 'FAILURE';

		// 4.6 Append transitionName to usedTransitionNames.
		usedTransitionNames.add(transitionName);

		// 4.7 If namedElements[transitionName] does not exist, then set namedElements[transitionName] to a new captured element struct.
		if (!namedElements.has(transitionName)) {
			namedElements.set(transitionName, structuredClone(capturedElementStruct));
		}
		
		// 4.8 Set namedElements[transitionName]'s new element to element.
		namedElements.get(transitionName).newElement = element;
		
		// 4.x Non-spec compliant: We also snapshot the new element because
		// we also need to have a texture of it. If only we had element() …
		namedElements.get(transitionName).newImage = await html2canvas(element, {
			// backgroundColor: null,
			allowTaint: true,
			useCORS: true,
		});
	}
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#setup-transition-pseudo-elements
const setupTransitionPseudoElements = (transition) => {
	debug && console.log('setupTransitionPseudoElements');
	// 1. Let document be this’s relevant global object’s associated document.
	// @NOOP
	
	// 2. Set document’s show view transition tree to true.
	setShowViewTransitionTree(true);
	
	// 3. For each transitionName → capturedElement of transition’s named elements:
	transition.namedElements.forEach((capturedElement, transitionName) => {
		
		// 3.1. Let group be a new ::view-transition-group(), with its view transition name set to transitionName.
		let group = createElement('div', {
			data: { pseudo: `::view-transition-group(${transitionName})` },
		});
		
		// 3.2. Append group to transition’s transition root pseudo-element.
		transition.transitionRoot.appendChild(group);

		// 3.3. Let imagePair be a new ::view-transition-image-pair(), with its view transition name set to transitionName.
		let imagePair = createElement('div', {
			data: { pseudo: `::view-transition-image-pair(${transitionName})` },
		});

		// 3.4. Append imagePair to group.
		group.appendChild(imagePair);

		// 3.5. If capturedElement’s old image is not null, then:
		if (capturedElement.oldImage !== null) {

			// 3.5.1. Let old be a new ::view-transition-old(), with its view transition name set to transitionName, displaying capturedElement’s old image as its replaced content.
			const old = createElement('div', {
				data: { pseudo: `::view-transition-old(${transitionName})` },
				children: [
					capturedElement.oldImage,
				],
				// style: `background-image: url(${capturedElement.oldImage.toDataURL()})`,
			});
			
			// 3.5.2 Append old to imagePair.
			imagePair.appendChild(old);
		}
		
		// 3.6 If capturedElement’s new element is not null, then:
		if (capturedElement.newImage !== null) {

			// 3.6.1 Let new be a new ::view-transition-new(), with its view transition name set to transitionName.
			// Note: The styling of this pseudo is handled in update pseudo-element styles.
			const neww = createElement('div', {
				data: { pseudo: `::view-transition-new(${transitionName})` },
				children: [
					capturedElement.newImage,
				],
				// style: `background-image: url(${capturedElement.newImage.toDataURL()})`,
			});
			
			// 3.6.2 Append new to imagePair.
			imagePair.appendChild(neww);
			
		}

		// 3.7 If capturedElement’s old image is null, then:
		if (capturedElement.oldImage === null) {

			// 3.7.1 Assert: capturedElement’s new element is not null.
			if (capturedElement.newImage === null) {
				throw new Error('Assertion failed: capturedElement’s new element is not null');
			}

			// 3.7.2 Set capturedElement’s image animation name rule to a new CSSStyleRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
		  //
		  // ```
			// :root::view-transition-new(transitionName) {
			//    animation-name: -ua-view-transition-fade-in;
			// }
			// ```
		  //
			// Note: The above code example contains variables to be replaced.
			capturedElement.styleDefinitions.imageAnimationNameRule = createCSSStyleRule(`
				[data-pseudo="::view-transition-new(${transitionName})"] {
				  animation-name: -ua-view-transition-fade-in;
        }
			`);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.imageAnimationNameRule);
		}
		
		// 3.8. If capturedElement’s new element is null, then:
		if (capturedElement.newImage === null) {

			// 3.8.1 Assert: capturedElement’s old image is not null.
			if (capturedElement.oldImage === null) {
				throw new Error('Assertion failed: capturedElement’s old image is not null.');
			}

			// 3.8.2 Set capturedElement’s image animation name rule to a new CSSStyleRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
		  //
		  // ```
			// :root::view-transition-old(transitionName) {
			//    animation-name: -ua-view-transition-fade-out;
			// }
			// ```
		  //
			// Note: The above code example contains variables to be replaced.
			capturedElement.styleDefinitions.imageAnimationNameRule = createCSSStyleRule(`
				[data-pseudo="::view-transition-old(${transitionName})"] {
				  animation-name: -ua-view-transition-fade-out;
        }
			`);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.imageAnimationNameRule);
		}
		
		// 3.9 If both of capturedElement’s old image and new element are not null, then:
		if ((capturedElement.oldImage !== null) && (capturedElement.newImage !== null)) {

			// 3.9.1 Let transform be capturedElement’s old transform.
			let transform = capturedElement.oldTransform;

			// 3.9.2 Let width be capturedElement’s old width.
			let width = capturedElement.oldWidth;

			// 3.9.3 Let height be capturedElement’s old height.
			let height = capturedElement.oldHeight;

			// 3.9.4 Set capturedElement’s group keyframes to a new CSSKeyframesRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
		  //
		  // ```
		  // @keyframes -ua-view-transition-group-anim-transitionName {
		  //   from {
		  // 	  transform: transform;
		  // 	  width: width;
		  // 	  height: height;
		  //   }
		  // }
		  // ```
		  // 
		  // Note: The above code example contains variables to be replaced.
			capturedElement.styleDefinitions.groupKeyframes = createCSSKeyframeRule(`
			@keyframes -ua-view-transition-group-anim-${transitionName} {
				from {
					transform: ${transform};
					width: ${width}px;
					height: ${height}px;
				}
			}`);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.groupKeyframes);

			// 3.9.5 Set capturedElement’s group animation name rule to a new CSSStyleRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
		  //
		  // ```
		  // :root::view-transition-group(transitionName) {
		  //   animation-name: -ua-view-transition-group-anim-transitionName;
		  // }
		  // ```
		  // 
		  // Note: The above code example contains variables to be replaced.
			capturedElement.styleDefinitions.groupAnimationNameRule = createCSSStyleRule(`
				[data-pseudo="::view-transition-group(${transitionName})"] {
				  animation-name: -ua-view-transition-group-anim-${transitionName};
        }
			`);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.groupAnimationNameRule);

			// 3.9.6 Set capturedElement’s image pair isolation rule to a new CSSStyleRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
		  //
		  // ```
		  // :root::view-transition-image-pair(transitionName) {
		  //   isolation: isolate;
		  //  }
		  // ```
		  //
		  // Note: The above code example contains variables to be replaced.
			capturedElement.styleDefinitions.imagePairIsolationRule = createCSSStyleRule(`
				[data-pseudo="::view-transition-image-pair(${transitionName})"] {
				  isolation: isolate;
        }
			`);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.imagePairIsolationRule);

			// 3.9.7 Set capturedElement’s image animation name rule to a new CSSStyleRule representing the following CSS, and append it to document’s dynamic view transition style sheet:
			// #SPECISSUE: These are two rules …
		  //
		  // ```
		  // :root::view-transition-old(transitionName) {
		  //   animation-name: -ua-view-transition-fade-out, -ua-mix-blend-mode-plus-lighter;
		  // }
		  // :root::view-transition-new(transitionName) {
		  //   animation-name: -ua-view-transition-fade-in, -ua-mix-blend-mode-plus-lighter;
		  // }
		  // ```
		  //
			// Note: The above code example contains variables to be replaced.
			// Note: mix-blend-mode: plus-lighter ensures that the blending of identical pixels from the old and new images results in the same color value as those pixels, and achieves a “correct” cross-fade.

			capturedElement.styleDefinitions.imageAnimationNameRule = createCSSStyleRule(`
			:root {
				[data-pseudo="::view-transition-old(${transitionName})"] {
				  animation-name: -ua-view-transition-fade-out, -ua-mix-blend-mode-plus-lighter;
        }
				[data-pseudo="::view-transition-new(${transitionName})"] {
				  animation-name: -ua-view-transition-fade-in, -ua-mix-blend-mode-plus-lighter;
        }
			}`);
			console.log(capturedElement.styleDefinitions.imageAnimationNameRule);
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.imageAnimationNameRule);
			
			// debugger;
		}
	});
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#update-pseudo-element-styles
const updatePseudoElementStyles = (transition) => {
	debug && console.log('updatePseudoElementStyles');
	// 1. For each transitionName → capturedElement of transition’s named elements:
	transition.namedElements.forEach((capturedElement, transitionName) => {
		// 1.1. Let width, height, transform, writingMode, direction, textOrientation, mixBlendMode, backdropFilter and colorScheme be null.
		let width, height, transform, writingMode, direction, textOrientation, mixBlendMode, backdropFilter, colorScheme;
		
		// 1.2. If capturedElement’s new element is null, then:
		if (capturedElement.newElement === null) {

			// 1.2.1 Set width to capturedElement’s old width.
			width = capturedElement.oldWidth;

			// 1.2.2 Set height to capturedElement’s old height.
			height = capturedElement.oldHeight;

			// 1.2.3 Set transform to capturedElement’s old transform.
			transform = capturedElement.oldTransform;

			// 1.2.4 Set writingMode to capturedElement’s old writing-mode.
			writingMode = capturedElement.oldWritingMode;

			// 1.2.5 Set direction to capturedElement’s old direction.
			direction = capturedElement.oldDirection;

			// 1.2.6 Set textOrientation to capturedElement’s old text-orientation.
			textOrientation = capturedElement.oldTextOrientation;

			// 1.2.7 Set mixBlendMode to capturedElement’s old mix-blend-mode.
			mixBlendMode = capturedElement.oldMixBlendMode;

			// 1.2.8 Set backdropFilter to capturedElement’s old backdrop-filter.
			backdropFilter = capturedElement.oldBackdropFilter;

			// 1.2.9 Set colorScheme to capturedElement’s old color-scheme.
			colorScheme = capturedElement.oldColorScheme;
		}
		
		// 1.3 Otherwise:
		else {
			// 1.3.1. Return failure if any of the following conditions are true:
			// - capturedElement’s new element has a flat tree ancestor that skips its contents.
			// - capturedElement’s new element is not rendered.
			// - capturedElement has more than one box fragment.
			// Note: Other rendering constraints are enforced via capturedElement’s new element being captured in a view transition.
			// @TODO

			// 1.3.2. Let newRect be the snapshot containing block if capturedElement’s new element is the document element, otherwise, capturedElement’s border box.
			let newRect;
			if (capturedElement.newElement === document.documentElement) {
				newRect = {
					width: snapshotContainingBlockSize.width,
					height: snapshotContainingBlockSize.height,
					x: 0,
					y: 0,
					top: 0,
					left: 0,
					bottom: snapshotContainingBlockSize.height,
					right: snapshotContainingBlockSize.width,
				};
			} else {
				newRect = capturedElement.newElement.getBoundingClientRect();
			}
			
			// 1.3.3. Set width to the current width of newRect.
			width = newRect.width;
			
			// 1.3.4. Set height to the current height of newRect.
			height = newRect.height;

			// 1.3.5. Set transform to a transform that would map newRect from the snapshot containing block origin to its current visual position.
			transform = `matrix(1, 0, 0, 1, ${newRect.x}, ${newRect.y})`;

			// 1.3.6. Set writingMode to the computed value of writing-mode on capturedElement’s new element.
			writingMode = getComputedStyle(capturedElement.newElement).writingMode;
			
			// 1.3.7. Set direction to the computed value of direction on capturedElement’s new element.
			direction = getComputedStyle(capturedElement.newElement).direction;

			// 1.3.8. Set textOrientation to the computed value of text-orientation on capturedElement’s new element.
			textOrientation = getComputedStyle(capturedElement.newElement).textOrientation;

			// 1.3.9. Set mixBlendMode to the computed value of mix-blend-mode on capturedElement’s new element.
			mixBlendMode = getComputedStyle(capturedElement.newElement).mixBlendMode;

			// 1.3.10. Set backdropFilter to the computed value of backdrop-filter on capturedElement’s new element.
			backdropFilter = getComputedStyle(capturedElement.newElement).backdropFilter;

			// 1.3.11. Set colorScheme to the computed value of color-scheme on capturedElement’s new element.
			colorScheme = getComputedStyle(capturedElement.newElement).colorScheme;
		}
		
		// 1.4 If capturedElement’s group styles rule is null,
		// then set capturedElement’s group styles rule to a new CSSStyleRule representing the following CSS,
		// and append it to transition’s relevant global object’s associated document’s dynamic view transition style sheet.
		// 
		// Otherwise, update capturedElement’s group styles rule to match the following CSS:
		//
		// ```
		// :root::view-transition-group(transitionName) {
		//   width: width;
		//   height: height;
		//   transform: transform;
		//   writing-mode: writingMode;
		//   direction: direction;
		//   text-orientation: textOrientation;
		//   mix-blend-mode: mixBlendMode;
		//   backdrop-filter: backdropFilter;
		//   color-scheme: colorScheme;
		// }
		// ```
		//
		//  NOTE: The above code example contains variables to be replaced.
		const rule = createCSSStyleRule(`
			[data-pseudo="::view-transition-group(${transitionName})"] {
				width: ${width}px;
				height: ${height}px;
				transform: ${transform};
				writing-mode: ${writingMode};
				direction: ${direction};
				text-orientation: ${textOrientation};
				mix-blend-mode: ${mixBlendMode};
				backdrop-filter: ${backdropFilter};
				color-scheme: ${colorScheme};
      }
		`);
		if (capturedElement.styleDefinitions.groupStylesRule === null) {
			capturedElement.styleDefinitions.groupStylesRule = rule;
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.groupStylesRule);
		} else {
			viewTransitionStyleSheet.deleteRule(capturedElement.styleDefinitions.groupStylesRule);
			capturedElement.styleDefinitions.groupStylesRule = rule;
			viewTransitionStyleSheet.insertRule(capturedElement.styleDefinitions.groupStylesRule);
		}
		
		// 1.5. If capturedElement’s new element is not null, then:
		if (capturedElement.newELement != null) {
			// 1.5.1 Let new be the ::view-transition-new() with the view transition name transitionName.
			let neww = transition.transitionRoot.querySelector(`[data-pseudo="::view-transition-new(${transitionName})"]`);

			// 1.5.2 Set new’s replaced element content to the result of capturing the image of capturedElement’s new element.
			// @NOTE: We use the non-spec compliant newImage here. If only we had element() …
			neww.appendChild(capturedElement.newImage);
		}
	});
	
	// NOTE: This algorithm must be executed to update styles in user-agent origin if its effects can be observed by a web API.
	// @TODO: Do we?
	
}

// @ref https://drafts.csswg.org/css-view-transitions-1/#capture-the-image-algorithm
const captureTheImage = async (element) => {
	debug && console.log('captureTheImage');
	
	// 1. If element is the document element, then:
	if (element === document.documentElement) {
		// 1.1. Render the region of document (including its canvas background and any top layer content)
		// that intersects the snapshot containing block, on a transparent canvas the size of the snapshot containing block,
		// following the capture rendering characteristics, and these additional characteristics:
		// 
		// - Areas outside element’s scrolling box should be rendered as if they were scrolled to,
		//   without moving or resizing the layout viewport.
		//   This must not trigger events related to scrolling or resizing, such as IntersectionObservers.
		// 
		// - Areas that cannot be scrolled to (i.e. they are out of scrolling bounds),
		//   should render the canvas background.
		// 
		// @TODO: Figure out if html2canvas limits to the viewport by default (I think it does?!)
		const canvas = await html2canvas(element, {
			// backgroundColor: null,
			allowTaint: true,
			useCORS: true,
		});
		
		// 1.2 Return this canvas as an image. The natural size of the image is equal to the snapshot containing block.
		return canvas;
	}
	
	// 2. Otherwise:
	else {
		// 2.1 Render element and its descendants, at the same size it appears in its node document,
		// over an infinite transparent canvas, following the capture rendering characteristics.
		// @NOOP

		// 2.2 Return the portion of this canvas that includes element’s ink overflow rectangle as an image.
		// The natural dimensions of this image must be those of its principal border box,
		// and its origin must correspond to that border box’s origin,
		// such that the image represents the contents of this border box and any captured ink overflow
		// is represented outside these bounds.
		const canvas = await html2canvas(element, {
			// backgroundColor: null,
			allowTaint: true,
			useCORS: true,
		});
		
		return canvas;
	}
};