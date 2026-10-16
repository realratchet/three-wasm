import { Quaternion } from "three/src/math/Quaternion.js";
import { warn } from "three/src/utils.js";

const X = Symbol("euler.x");
const Y = Symbol("euler.y");
const Z = Symbol("euler.z");
const PENDING = Symbol("euler.pending");
const QX = Symbol("euler.qx");
const QY = Symbol("euler.qy");
const QZ = Symbol("euler.qz");
const QW = Symbol("euler.qw");
const QORDER = Symbol("euler.qorder");

const ORDERS = new Set(["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"]);

class Euler {
    constructor(x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER) {

        this.isEuler = true;

        this[PENDING] = false;
        this[QX] = 0;
        this[QY] = 0;
        this[QZ] = 0;
        this[QW] = 1;
        this[QORDER] = order;

        this[X] = x;
        this[Y] = y;
        this[Z] = z;
        this._order = order;
    }

    get _x() { // Quaternion.setFromEuler reads _x/_y/_z directly

        if (this[PENDING]) this._resolve();
        return this[X];
    }

    set _x(value) {

        if (this[PENDING]) this._resolve();
        this[X] = value;
    }

    get _y() {

        if (this[PENDING]) this._resolve();
        return this[Y];
    }

    set _y(value) {

        if (this[PENDING]) this._resolve();
        this[Y] = value;
    }

    get _z() {

        if (this[PENDING]) this._resolve();
        return this[Z];
    }

    set _z(value) {

        if (this[PENDING]) this._resolve();
        this[Z] = value;
    }

    get x() {

        return this._x;
    }

    set x(value) {

        this._x = value;
        this._onChangeCallback();
    }

    get y() {

        return this._y;
    }

    set y(value) {

        this._y = value;
        this._onChangeCallback();
    }

    get z() {

        return this._z;
    }

    set z(value) {

        this._z = value;
        this._onChangeCallback();
    }

    get order() {

        return this._order;
    }

    set order(value) {

        this._order = value;
        this._onChangeCallback();
    }

    set(x, y, z, order = this._order) {

        this[PENDING] = false;
        this[X] = x;
        this[Y] = y;
        this[Z] = z;
        this._order = order;
        this._onChangeCallback();

        return this;
    }

    clone() {

        return new this.constructor(this._x, this._y, this._z, this._order);
    }

    copy(euler) {

        const x = euler._x, y = euler._y, z = euler._z;
        this[PENDING] = false;
        this[X] = x;
        this[Y] = y;
        this[Z] = z;
        this._order = euler._order;
        this._onChangeCallback();

        return this;
    }

    setFromRotationMatrix(m, order = this._order, update = true) {

        const te = m.elements;

        this._setFromBasis(te[0], te[4], te[8], te[1], te[5], te[9], te[2], te[6], te[10], order);
        this._order = order;

        if (update === true) this._onChangeCallback();

        return this;
    }

    setFromQuaternion(q, order, update) {

        if (order === undefined) order = this._order; // setFromRotationMatrix defaults

        if (update === undefined || update === true || ! ORDERS.has(order)) {
            this._setFromQuaternionNow(q._x, q._y, q._z, q._w, order);
            this._order = order;
            if (update === undefined || update === true) this._onChangeCallback();
            return this;
        }

        this[QX] = q._x;
        this[QY] = q._y;
        this[QZ] = q._z;
        this[QW] = q._w;
        this[QORDER] = order;
        this[PENDING] = true;
        this._order = order;

        return this;
    }

    setFromVector3(v, order = this._order) {

        return this.set(v.x, v.y, v.z, order);
    }

    reorder(newOrder) {

        _quaternion.setFromEuler(this);

        return this.setFromQuaternion(_quaternion, newOrder);
    }

    equals(euler) {

        return (euler._x === this._x) && (euler._y === this._y) && (euler._z === this._z) && (euler._order === this._order);
    }

    fromArray(array) {

        this[PENDING] = false;
        this[X] = array[0];
        this[Y] = array[1];
        this[Z] = array[2];
        if (array[3] !== undefined) this._order = array[3];

        this._onChangeCallback();

        return this;
    }

    toArray(array = [], offset = 0) {

        array[offset] = this._x;
        array[offset + 1] = this._y;
        array[offset + 2] = this._z;
        array[offset + 3] = this._order;

        return array;
    }

    _onChange(callback) {

        this._onChangeCallback = callback;

        return this;
    }

    _onChangeCallback() {}

    *[Symbol.iterator]() {

        yield this._x;
        yield this._y;
        yield this._z;
        yield this._order;
    }

    _resolve() {

        this[PENDING] = false;
        this._setFromQuaternionNow(this[QX], this[QY], this[QZ], this[QW], this[QORDER]);
    }

    _setFromQuaternionNow(x, y, z, w, order) { // makeRotationFromQuaternion + setFromRotationMatrix, upper 3x3 only

        const x2 = x + x,	y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        this._setFromBasis(
            1 - (yy + zz), xy - wz, xz + wy,
            xy + wz, 1 - (xx + zz), yz - wx,
            xz - wy, yz + wx, 1 - (xx + yy),
            order);
    }

    _setFromBasis(m11, m12, m13, m21, m22, m23, m31, m32, m33, order) { // setFromRotationMatrix body without touching _order; mNN is row N, column N

        const pending = this[PENDING];
        this[PENDING] = false;

        switch (order) {
            case "XYZ":

                this[Y] = Math.asin(clamp(m13, -1, 1));

                if (Math.abs(m13) < 0.9999999) {
                    this[X] = Math.atan2(-m23, m33);
                    this[Z] = Math.atan2(-m12, m11);
                } else {
                    this[X] = Math.atan2(m32, m22);
                    this[Z] = 0;
                }

                break;

            case "YXZ":

                this[X] = Math.asin(-clamp(m23, -1, 1));

                if (Math.abs(m23) < 0.9999999) {
                    this[Y] = Math.atan2(m13, m33);
                    this[Z] = Math.atan2(m21, m22);
                } else {
                    this[Y] = Math.atan2(-m31, m11);
                    this[Z] = 0;
                }

                break;

            case "ZXY":

                this[X] = Math.asin(clamp(m32, -1, 1));

                if (Math.abs(m32) < 0.9999999) {
                    this[Y] = Math.atan2(-m31, m33);
                    this[Z] = Math.atan2(-m12, m22);
                } else {
                    this[Y] = 0;
                    this[Z] = Math.atan2(m21, m11);
                }

                break;

            case "ZYX":

                this[Y] = Math.asin(-clamp(m31, -1, 1));

                if (Math.abs(m31) < 0.9999999) {
                    this[X] = Math.atan2(m32, m33);
                    this[Z] = Math.atan2(m21, m11);
                } else {
                    this[X] = 0;
                    this[Z] = Math.atan2(-m12, m22);
                }

                break;

            case "YZX":

                this[Z] = Math.asin(clamp(m21, -1, 1));

                if (Math.abs(m21) < 0.9999999) {
                    this[X] = Math.atan2(-m23, m22);
                    this[Y] = Math.atan2(-m31, m11);
                } else {
                    this[X] = 0;
                    this[Y] = Math.atan2(m13, m33);
                }

                break;

            case "XZY":

                this[Z] = Math.asin(-clamp(m12, -1, 1));

                if (Math.abs(m12) < 0.9999999) {
                    this[X] = Math.atan2(m32, m22);
                    this[Y] = Math.atan2(m13, m11);
                } else {
                    this[X] = Math.atan2(-m23, m33);
                    this[Y] = 0;
                }

                break;

            default:

                if (pending) this._setFromQuaternionNow(this[QX], this[QY], this[QZ], this[QW], this[QORDER]); // pending still lands before three's unknown-order no-op
                warn("Euler: .setFromRotationMatrix() encountered an unknown order: " + order);
        }
    }
}

Euler.DEFAULT_ORDER = "XYZ";

function clamp(value, min, max) {

    return Math.max(min, Math.min(max, value));
}

const _quaternion = /*@__PURE__*/ new Quaternion();

export { Euler };
