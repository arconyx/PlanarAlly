import { uuidv4 } from "@/core/utils";
import { socket } from "@/game/api/socket";
import { aurasFromServer, aurasToServer } from "@/game/comm/conversion/aura";
import { InitiativeData } from "@/game/comm/types/general";
import { ServerShape } from "@/game/comm/types/shapes";
import { GlobalPoint, LocalPoint, Vector } from "@/game/geom";
import { layerManager } from "@/game/layers/manager";
import { BoundingRect } from "@/game/shapes/boundingrect";
import { gameStore } from "@/game/store";
import { g2l, g2lr, g2lx, g2ly, g2lz } from "@/game/units";
import tinycolor from "tinycolor2";
import { visibilityStore } from "../visibility/store";

export abstract class Shape {
    // Used to create class instance from server shape data
    abstract readonly type: string;
    // The unique ID of this shape
    readonly uuid: string;
    // The layer the shape is currently on
    layer!: string;

    // A reference point regarding that specific shape's structure
    protected _refPoint: GlobalPoint;

    // Fill colour of the shape
    fillColour: string = "#000";
    strokeColour: string = "rgba(0,0,0,0)";
    // The optional name associated with the shape
    name = "Unknown shape";
    nameVisible = true;

    // Associated trackers/auras/owners
    trackers: Tracker[] = [];
    auras: Aura[] = [];
    labels: Label[] = [];
    protected _owners: string[] = [];

    // Block light sources
    visionObstruction = false;
    // Prevent shapes from overlapping with this shape
    movementObstruction = false;
    // Does this shape represent a playable token
    isToken = false;
    // Show a highlight box
    showHighlight = false;

    // Mouseover annotation
    annotation: string = "";

    // Draw modus to use
    globalCompositeOperation: string = "source-over";

    // Additional options for specialized uses
    options: Map<string, any> = new Map();

    constructor(refPoint: GlobalPoint, fillColour?: string, strokeColour?: string, uuid?: string) {
        this._refPoint = refPoint;
        this.uuid = uuid || uuidv4();
        if (fillColour !== undefined) this.fillColour = fillColour;
        if (strokeColour !== undefined) this.strokeColour = strokeColour;
    }

    // Are the last and first point connected
    get isClosed(): boolean {
        return true;
    }

    get refPoint(): GlobalPoint {
        return this._refPoint;
    }
    set refPoint(point: GlobalPoint) {
        this._refPoint = point;
    }

    abstract getBoundingBox(): BoundingRect;

    // If inWorldCoord is
    abstract contains(point: GlobalPoint): boolean;

    abstract center(): GlobalPoint;
    abstract center(centerPoint: GlobalPoint): void;
    visibleInCanvas(_canvas: HTMLCanvasElement): boolean {
        // for (const aura of this.auras) {
        //     if (aura.value > 0) {
        //         const auraCircle = new Circle(this.center(), aura.value);
        //         if (auraCircle.visibleInCanvas(canvas)) return true;
        //     }
        // }
        return false;
    }

    // Code to snap a shape to the grid
    // This is shape dependent as the shape refPoints are shape specific in
    abstract snapToGrid(): void;
    abstract resizeToGrid(): void;
    abstract resize(resizePoint: number, point: LocalPoint): void;

    abstract get points(): number[][];

    getPointIndex(p: GlobalPoint, delta = 0): number {
        for (const [idx, point] of this.points.entries()) {
            if (Math.abs(p.x - point[0]) <= delta && Math.abs(p.y - point[1]) <= delta) return idx;
        }
        return -1;
    }

    getPointOrientation(i: number): Vector {
        const prev = GlobalPoint.fromArray(this.points[(this.points.length + i - 1) % this.points.length]);
        const point = GlobalPoint.fromArray(this.points[i]);
        const next = GlobalPoint.fromArray(this.points[(i + 1) % this.points.length]);
        const vec = next.subtract(prev);
        const mid = prev.add(vec.multiply(0.5));
        return point.subtract(mid).normalize();
    }

    invalidate(skipLightUpdate: boolean): void {
        const l = layerManager.getLayer(this.layer);
        if (l) l.invalidate(skipLightUpdate);
    }

    checkVisionSources(recalculate = true): void {
        const self = this;
        const obstructionIndex = visibilityStore.visionBlockers.indexOf(this.uuid);
        let update = false;
        if (this.visionObstruction && obstructionIndex === -1) {
            visibilityStore.visionBlockers.push(this.uuid);
            update = true;
        } else if (!this.visionObstruction && obstructionIndex >= 0) {
            visibilityStore.visionBlockers.splice(obstructionIndex, 1);
            update = true;
        }
        if (update && recalculate) visibilityStore.recalculateVision();

        // Check if the visionsource auras are in the gameManager
        for (const au of this.auras) {
            const ls = visibilityStore.visionSources;
            const i = ls.findIndex(o => o.aura === au.uuid);
            if (au.visionSource && i === -1) {
                ls.push({ shape: self.uuid, aura: au.uuid });
            } else if (!au.visionSource && i >= 0) {
                ls.splice(i, 1);
            }
        }
        // Check if anything in the gameManager referencing this shape is in fact still a visionsource
        for (let i = visibilityStore.visionSources.length - 1; i >= 0; i--) {
            const ls = visibilityStore.visionSources[i];
            if (ls.shape === self.uuid) {
                if (!self.auras.some(a => a.uuid === ls.aura && a.visionSource))
                    visibilityStore.visionSources.splice(i, 1);
            }
        }
    }

    setMovementBlock(blocksMovement: boolean, recalculate = true): void {
        this.movementObstruction = blocksMovement || false;
        const obstructionIndex = visibilityStore.movementblockers.indexOf(this.uuid);
        let update = false;
        if (this.movementObstruction && obstructionIndex === -1) {
            visibilityStore.movementblockers.push(this.uuid);
            update = true;
        } else if (!this.movementObstruction && obstructionIndex >= 0) {
            visibilityStore.movementblockers.splice(obstructionIndex, 1);
            update = true;
        }
        if (update && recalculate) visibilityStore.recalculateMovement();
    }

    setIsToken(isToken: boolean): void {
        this.isToken = isToken;
        if (this.ownedBy()) {
            const i = gameStore.ownedtokens.indexOf(this.uuid);
            if (this.isToken && i === -1) gameStore.ownedtokens.push(this.uuid);
            else if (!this.isToken && i >= 0) gameStore.ownedtokens.splice(i, 1);
        }
    }

    abstract asDict(): ServerShape;
    getBaseDict(): ServerShape {
        return {
            type_: this.type,
            uuid: this.uuid,
            x: this.refPoint.x,
            y: this.refPoint.y,
            layer: this.layer,
            // eslint-disable-next-line @typescript-eslint/camelcase
            draw_operator: this.globalCompositeOperation,
            // eslint-disable-next-line @typescript-eslint/camelcase
            movement_obstruction: this.movementObstruction,
            // eslint-disable-next-line @typescript-eslint/camelcase
            vision_obstruction: this.visionObstruction,
            auras: aurasToServer(this.auras),
            trackers: this.trackers,
            labels: this.labels,
            owners: this._owners,
            // eslint-disable-next-line @typescript-eslint/camelcase
            fill_colour: this.fillColour,
            // eslint-disable-next-line @typescript-eslint/camelcase
            stroke_colour: this.strokeColour,
            name: this.name,
            // eslint-disable-next-line @typescript-eslint/camelcase
            name_visible: this.nameVisible,
            annotation: this.annotation,
            // eslint-disable-next-line @typescript-eslint/camelcase
            is_token: this.isToken,
            options: JSON.stringify([...this.options]),
        };
    }
    fromDict(data: ServerShape): void {
        this.layer = data.layer;
        this.globalCompositeOperation = data.draw_operator;
        this.movementObstruction = data.movement_obstruction;
        this.visionObstruction = data.vision_obstruction;
        this.auras = aurasFromServer(data.auras);
        this.trackers = data.trackers;
        this.labels = data.labels;
        this._owners = data.owners;
        this.isToken = data.is_token;
        this.nameVisible = data.name_visible;
        if (data.annotation) this.annotation = data.annotation;
        if (data.name) this.name = data.name;
        if (data.options) this.options = new Map(JSON.parse(data.options));
    }

    draw(ctx: CanvasRenderingContext2D): void {
        if (this.globalCompositeOperation !== undefined) ctx.globalCompositeOperation = this.globalCompositeOperation;
        else ctx.globalCompositeOperation = "source-over";
        if (this.showHighlight) {
            const bbox = this.getBoundingBox();
            ctx.strokeStyle = "red";
            ctx.strokeRect(g2lx(bbox.topLeft.x) - 5, g2ly(bbox.topLeft.y) - 5, g2lz(bbox.w) + 10, g2lz(bbox.h) + 10);
        }
    }

    drawAuras(ctx: CanvasRenderingContext2D): void {
        for (const aura of this.auras) {
            if (aura.value === 0 && aura.dim === 0) return;
            ctx.beginPath();

            const loc = g2l(this.center());
            const innerRange = g2lr(aura.value + aura.dim);

            if (aura.dim === 0) ctx.fillStyle = aura.colour;
            else {
                const gradient = ctx.createRadialGradient(
                    loc.x,
                    loc.y,
                    g2lr(aura.value),
                    loc.x,
                    loc.y,
                    g2lr(aura.value + aura.dim),
                );
                const tc = tinycolor(aura.colour);
                ctx.fillStyle = gradient;
                gradient.addColorStop(0, aura.colour);
                gradient.addColorStop(1, tc.setAlpha(0).toRgbString());
            }
            if (!aura.visionSource || aura.lastPath === undefined) {
                ctx.arc(loc.x, loc.y, innerRange, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                try {
                    ctx.fill(aura.lastPath);
                } catch (e) {
                    ctx.arc(loc.x, loc.y, innerRange, 0, 2 * Math.PI);
                    ctx.fill();
                    console.warn(e);
                }
            }
        }
    }

    drawSelection(ctx: CanvasRenderingContext2D): void {
        ctx.globalCompositeOperation = this.globalCompositeOperation;
        const z = gameStore.zoomFactor;
        const bb = this.getBoundingBox();
        ctx.strokeRect(g2lx(bb.topLeft.x), g2ly(bb.topLeft.y), bb.w * z, bb.h * z);

        // Draw vertices
        for (const p of this.points) {
            ctx.beginPath();
            ctx.arc(g2lx(p[0]), g2ly(p[1]), 3, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Draw edges
        ctx.beginPath();
        ctx.moveTo(g2lx(this.points[0][0]), g2ly(this.points[0][1]));
        const j = this.isClosed ? 0 : 1;
        for (let i = 1; i <= this.points.length - j; i++) {
            const vertex = this.points[i % this.points.length];
            ctx.lineTo(g2lx(vertex[0]), g2ly(vertex[1]));
        }
        ctx.stroke();
    }

    getInitiativeRepr(): InitiativeData {
        return {
            uuid: this.uuid,
            visible: !gameStore.IS_DM,
            group: false,
            source: this.name,
            // eslint-disable-next-line @typescript-eslint/camelcase
            has_img: false,
            effects: [],
            index: Infinity,
        };
    }

    moveLayer(layer: string, sync: boolean): void {
        const oldLayer = layerManager.getLayer(this.layer);
        const newLayer = layerManager.getLayer(layer);
        if (oldLayer === undefined || newLayer === undefined) return;
        this.layer = layer;
        // Update layer shapes
        oldLayer.shapes.splice(oldLayer.shapes.indexOf(this), 1);
        newLayer.shapes.push(this);
        // Revalidate layers  (light should at most be redone once)
        oldLayer.invalidate(true);
        newLayer.invalidate(false);
        // Sync!
        if (sync) socket.emit("Shape.Layer.Change", { uuid: this.uuid, layer });
    }

    // this screws up vetur if typed as `readonly stringp[]`
    // eslint-disable-next-line @typescript-eslint/array-type
    get owners(): ReadonlyArray<string> {
        return Object.freeze(this._owners.slice());
    }

    ownedBy(username?: string): boolean {
        if (username === undefined) username = gameStore.username;
        return (
            gameStore.IS_DM ||
            this._owners.includes(username) ||
            (gameStore.FAKE_PLAYER && gameStore.activeTokens.includes(this.uuid))
        );
    }

    addOwner(owner: string): void {
        if (!this._owners.includes(owner)) this._owners.push(owner);
    }

    updateOwner(oldValue: string, newValue: string): void {
        const ownerIndex = this._owners.findIndex(o => o === oldValue);
        if (ownerIndex >= 0) this._owners.splice(ownerIndex, 1, newValue);
        else this.addOwner(newValue);
    }

    removeOwner(owner: string): void {
        const ownerIndex = this._owners.findIndex(o => o === owner);
        this._owners.splice(ownerIndex, 1);
    }
}
