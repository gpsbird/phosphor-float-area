// This file is part of phosphor-float-area, copyright (C) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import { Message } from '@phosphor/messaging';
import { ElementExt } from '@phosphor/domutils';
import { IDragEvent } from '@phosphor/dragdrop';
import { Widget, DockPanel } from '@phosphor/widgets';

import { DialogUpdateMessage, DialogRaiseMessage } from './DialogMessage';
import { Dialog } from './Dialog';
import { FloatLayout, sendLeaveEvent } from './FloatLayout';

const EDGE_SIZE = 40;

interface DragData {
	rect: ClientRect;

	width: number;
	height: number;

	imageOffsetX: number;
	imageOffsetY: number;

	offsetLeft: number;
	offsetTop: number;
	offsetRight: number;
	offsetBottom: number;
}

export class FloatArea extends Widget {

	constructor(options: FloatArea.Options = {}) {
		super({ node: FloatArea.createNode() });

		this.addClass('charto-FloatArea');

		this.backdropNode = document.createElement('div');
		this.backdropNode.className = 'charto-FloatArea-content';

		this.node.appendChild(this.backdropNode);

		if(options.overlay) {
			// Re-use an existing transparent overlay.
			// Pass it to a parent DockPanel first.
			this.overlay = options.overlay;
			this.overlayParent = this.overlay.node.parentNode as HTMLElement;
			this.ownOverlay = false;
		} else {
			// Create a new transparent overlay inside this widget.
			this.overlay = new DockPanel.Overlay();
			this.overlay.node.classList.add('charto-mod-noTransition');
			this.node.appendChild(this.overlay.node);
			this.overlayParent = this.node;
			this.ownOverlay = true;
		}

		const parentBox = ElementExt.boxSizing(this.overlayParent);
		this.edgeWidth = parentBox.borderLeft + parentBox.borderRight;
		this.edgeHeight = parentBox.borderTop + parentBox.borderBottom;

		this.layout = new FloatLayout();
	}

	static createNode(): HTMLElement {
		const node = document.createElement('div');
		return(node);
	}

	protected onBeforeAttach(msg: Message) {
		this.node.addEventListener('p-dragenter', this);
		this.node.addEventListener('p-dragleave', this);
		this.node.addEventListener('p-dragover', this);
		this.node.addEventListener('p-drop', this);
	}

	protected onAfterDetach(msg: Message) {
		this.node.removeEventListener('p-dragenter', this);
		this.node.removeEventListener('p-dragleave', this);
		this.node.removeEventListener('p-dragover', this);
		this.node.removeEventListener('p-drop', this);
	}

	processMessage(msg: Message): void {
		switch(msg.type) {
			case 'dialog-update':
				const move = msg as DialogUpdateMessage;

				(this.layout as FloatLayout).updateWidget(move.widget, move.x, move.y, move.width, move.height);
				break;

			case 'dialog-raise':
				const raise = msg as DialogRaiseMessage;

				(this.layout as FloatLayout).raiseWidget(raise.widget, raise.event);
				break;

			default:
				super.processMessage(msg);
		}
	}

	handleEvent(event: Event) {
		switch(event.type) {
			case 'p-dragenter':
				if(this.handleDragEnter(event as IDragEvent)) break;
				return;
			case 'p-dragleave':
				this.handleDragLeave(event as IDragEvent);

				// Allow dragleave events to bubble up so overlay's parent
				// can see if it's time to hide it.
				return;
			case 'p-dragover':
				if(this.handleDragOver(event as IDragEvent)) break;
				return;
			case 'p-drop':
				if(this.handleDrop(event as IDragEvent)) break;
				return;
		}

		// Note: p-dragenter must be eaten to receive other drag events.
		event.preventDefault();
		event.stopPropagation();
	}

	protected handleDragEnter(event: IDragEvent) {
		const widget = this.getDragged(event);
		if(!widget) return(false);

		let imageOffsetX = 0;
		let imageOffsetY = 0;
		let imageHeight = 0;

		// Equivalent to (dockPanel as any)._drag.dragImage if we had access.
		const dragImage = document.body.querySelector('.p-mod-drag-image') as HTMLElement;

		if(dragImage) {
			const imageRect = dragImage.getBoundingClientRect();
			imageOffsetX = dragImage.offsetLeft - imageRect.left;
			imageOffsetY = dragImage.offsetTop - imageRect.top;
			imageHeight = dragImage.offsetHeight;
		}

		const rect = this.node.getBoundingClientRect();
		const parentRect = this.overlayParent.getBoundingClientRect();
		let width = widget.node.offsetWidth;
		let height = widget.node.offsetHeight;

		const goldenRatio = 0.618;
		let inDialog = false;

		for(let parent = widget.parent; parent; parent = parent.parent) {
			if(parent instanceof Dialog) {
				inDialog = true;
				break;
			}
		}

		if(!inDialog) {
			// Widget is not inside a dialog, so it's probably docked.
			// Likely only one dimension was set by the user,
			// so make the proportions match the golden ratio.
			if(width > height / goldenRatio) width = height / goldenRatio;
			else if(height > width * goldenRatio) height = width * goldenRatio;
		}

		// Restrict initial floating panel size so its longer dimension
		// is half that of the area it's floating over.
		if(width > rect.width / 2) {
			width = rect.width / 2;
			height = width * goldenRatio;
		}
		if(height > rect.height / 2) {
			height = rect.height / 2;
			width = height / goldenRatio;
		}

		// Round size to integer.
		width = ~~(width + 0.5);
		height = ~~(height + 0.5);

		this.drag = {
			rect,

			width,
			height,

			imageOffsetX,
			imageOffsetY,

			offsetLeft: parentRect.left + imageOffsetX,
			offsetTop: parentRect.top + imageOffsetY - imageHeight,
			offsetRight: parentRect.width - width - this.edgeWidth,
			offsetBottom: parentRect.height - height - this.edgeHeight
		};

		this.overlayVisible = false;
		this.handleDragOver(event);

		return(true);
	}

	protected handleDragLeave(event: IDragEvent) {
		const related = event.relatedTarget as HTMLElement;

		if(!related || !this.node.contains(related)) {
			// Mouse left the bounds of this widget.
			this.hideOverlay(event);
			this.drag = null;
		}
	}

	protected handleDragOver(event: IDragEvent) {
		const drag = this.drag;
		if(!drag) return(false);

		if(this.onEdge(event)) {
			this.hideOverlay(event);
			return(false);
		} else {
			this.showOverlay(event);
		}

		const left = event.clientX - drag.offsetLeft;
		const top = event.clientY - drag.offsetTop;

		this.overlay.show({
			left, top,
			right: drag.offsetRight - left,
			bottom: drag.offsetBottom - top
		});

		// Tentatively accept the drag.
		event.dropAction = event.proposedAction;

		return(true);
	}

	protected handleDrop(event: IDragEvent) {
		this.overlay.hide(0);

		if(!this.ownOverlay) {
			// Enable animated transitions in overlay movement.
			this.overlay.node.classList.remove('charto-mod-noTransition');
		}

		const drag = this.drag;
		if(!drag) return(false);

		// Let a parent dock panel handle drops near area edges.
		if(this.onEdge(event)) return(false);

		const widget = this.getDragged(event);

		if(!widget) {
			event.dropAction = 'none';
			return(false);
		}

		// Deparent the widget and wait for layout changes to settle.
		widget.parent = null;

		(this.layout as FloatLayout).afterUpdate(() => {
			// Get updated float area bounds.
			const rect = this.node.getBoundingClientRect();

			// Take ownership of the dragged widget.
			this.addWidget(widget, {
				left: event.clientX - rect.left - drag.imageOffsetX,
				top: event.clientY - rect.top - drag.imageOffsetY,
				width: drag.width,
				height: drag.height
			});
		});

		this.update();

		// Accept the drag.
		event.dropAction = event.proposedAction;
		return(true);
	}

	getDragged(event: IDragEvent) {
		// Only handle drag events containing widgets.
		if(!(event as IDragEvent).mimeData.hasData('application/vnd.phosphor.widget-factory')) return(null);

		const factory = event.mimeData.getData('application/vnd.phosphor.widget-factory');
		const widget = (typeof(factory) == 'function' && factory());

		// Ensure the dragged widget is known and is not a parent of this widget.
		if(!(widget instanceof Widget) || widget.contains(this)) return(null);

		return(widget);
	}

	onEdge(event: IDragEvent) {
		const rect = this.drag!.rect;

		return(
			event.clientX - rect.left < EDGE_SIZE ||
			event.clientY - rect.top < EDGE_SIZE ||
			rect.right - event.clientX < EDGE_SIZE ||
			rect.bottom - event.clientY < EDGE_SIZE
		);
	}

	showOverlay(event: IDragEvent) {
		if(this.overlayVisible) return;
		this.overlayVisible = true;

		if(this.ownOverlay) {
			if(this.node.parentNode) {
				// In case a parent DockPanel is also showing an overlay,
				// send a p-dragleave event to trigger hiding it.
				sendLeaveEvent(event, this.node.parentNode as HTMLElement);
			}
		} else {
			// Probably re-using a DockPanel's overlay,
			// so disable animated transitions in its movement.
			this.overlay.node.classList.add('charto-mod-noTransition');
		}
	}

	hideOverlay(event: IDragEvent) {
		if(!this.overlayVisible) return;
		this.overlayVisible = false;

		if(this.ownOverlay) {
			this.overlay.hide(0);
		} else {
			// Enable animated transitions in overlay movement.
			this.overlay.node.classList.remove('charto-mod-noTransition');
		}
	}

	addWidget(widget: Widget, options: FloatLayout.AddOptions = {}): void {
		let targetNode: HTMLElement | undefined;

		if(options.placement == 'backdrop') targetNode = this.backdropNode;

		(this.layout as FloatLayout).addWidget(widget, options, targetNode);
	}

	backdropNode: HTMLElement;

	/** Transparent overlay indicating position of dragged widget if dropped. */
	overlay: DockPanel.IOverlay;
	/** Parent DOM node of the overlay. */
	overlayParent: HTMLElement;
	overlayVisible: boolean;
	/** Flag whether the overlay was created by this widget. */
	ownOverlay: boolean;
	/** Horizontal padding of overlayParent in pixels. */
	edgeWidth: number;
	/** Vertical padding of overlayParent in pixels. */
	edgeHeight: number;

	private drag: DragData | null;
}

export namespace FloatArea {
	export interface Options {
		overlay?: DockPanel.IOverlay;
	}
}
