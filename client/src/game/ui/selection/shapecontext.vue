<template>
    <ContextMenu
        v-if="getActiveLayer() !== undefined"
        :visible="visible"
        :left="x + 'px'"
        :top="y + 'px'"
        @close="close"
    >
        <li v-if="getLayers().length > 1">
            Layer
            <ul>
                <li
                    v-for="layer in getLayers()"
                    :key="layer.name"
                    :style="[getActiveLayer().name === layer.name ? { 'background-color': '#82c8a0' } : {}]"
                    @click="setLayer(layer.name)"
                >
                    {{ layer.name }}
                </li>
            </ul>
        </li>
        <li v-if="locations.length > 1">
            Location
            <ul>
                <li
                    v-for="location in locations"
                    :key="location"
                    :style="[getCurrentLocation() === location ? { 'background-color': '#82c8a0' } : {}]"
                    @click="setLocation(location)"
                >
                    {{ location }}
                </li>
            </ul>
        </li>
        <li @click="moveToBack">Move to back</li>
        <li @click="moveToFront">Move to front</li>
        <li @click="addInitiative">{{ getInitiativeWord() }} initiative</li>
        <li @click="deleteSelection">Delete shapes</li>
        <li v-if="hasSingleShape()" @click="openEditDialog">Show properties</li>
    </ContextMenu>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";

import { mapState } from "vuex";

import ContextMenu from "@/core/components/contextmenu.vue";

import { socket } from "@/game/api/socket";
import { ServerClient, ServerLocation } from "@/game/comm/types/general";
import { EventBus } from "@/game/event-bus";
import { layerManager } from "@/game/layers/manager";
import { gameStore } from "@/game/store";
import { cutShapes, deleteShapes, pasteShapes } from "../../shapes/utils";
import { initiativeStore, inInitiative } from "../initiative/store";

@Component({
    components: {
        ContextMenu,
    },
    computed: {
        ...mapState("game", ["locations", "assets", "notes"]),
    },
})
export default class ShapeContext extends Vue {
    visible = false;
    x = 0;
    y = 0;
    get activeLayer(): string {
        const layer = layerManager.getLayer();
        return layer === undefined ? "" : layer.name;
    }
    open(event: MouseEvent) {
        this.visible = true;
        this.x = event.pageX;
        this.y = event.pageY;
        this.$nextTick(() => (<HTMLElement>this.$children[0].$el).focus());
    }
    close() {
        this.visible = false;
    }
    getLayers() {
        return layerManager.layers.filter(l => l.selectable && (gameStore.IS_DM || l.playerEditable));
    }
    getActiveLayer() {
        return layerManager.getLayer();
    }
    getCurrentLocation() {
        return gameStore.locationName;
    }
    getInitiativeWord() {
        const layer = layerManager.getLayer()!;
        if (layer.selection.length === 1) {
            return inInitiative(layer.selection[0].uuid) ? "Show" : "Add";
        } else {
            return layer.selection.every(shape => inInitiative(shape.uuid)) ? "Show" : "Add all to";
        }
    }
    hasSingleShape(): boolean {
        const layer = layerManager.getLayer()!;
        return layer.selection.length === 1;
    }
    setLayer(newLayer: string) {
        const layer = layerManager.getLayer()!;
        layer.selection.forEach(shape => shape.moveLayer(newLayer, true));
        this.close();
    }
    setLocation(newLocation: string) {
        const layer = layerManager.getLayer()!;
        cutShapes();
        // Request change to other location
        socket.emit("Location.Change", newLocation);
        socket.once("Location.Set", (_data: Partial<ServerLocation>) => {
            socket.once("Client.Options.Set", (_options: ServerClient) => {
                layer.selection = pasteShapes(layer.name);
                layerManager.selectLayer(layer.name);
            });
        });
        this.close();
    }
    moveToBack() {
        const layer = this.getActiveLayer()!;
        layer.selection.forEach(shape => layer.moveShapeOrder(shape, 0, true));
        this.close();
    }
    moveToFront() {
        const layer = this.getActiveLayer()!;
        layer.selection.forEach(shape => layer.moveShapeOrder(shape, layer.shapes.length - 1, true));
        this.close();
    }
    addInitiative() {
        const layer = layerManager.getLayer()!;
        layer.selection.forEach(shape => initiativeStore.addInitiative(shape.getInitiativeRepr()));
        EventBus.$emit("Initiative.Show");
        this.close();
    }
    deleteSelection() {
        deleteShapes();
        this.close();
    }
    openEditDialog() {
        const layer = layerManager.getLayer()!;
        if (layer.selection.length !== 1) return;
        EventBus.$emit("EditDialog.Open", layer.selection[0]);
        this.close();
    }
}
</script>

<style scoped>
.ContextMenu ul {
    border: 1px solid #82c8a0;
}
.ContextMenu ul li {
    border-bottom: 1px solid #82c8a0;
}
.ContextMenu ul li:hover {
    background-color: #82c8a0;
}
</style>
