"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const RSQueue_1 = __importDefault(require("../lib/RSQueue"));
const db_1 = require("./database/db");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const orderQueue = new RSQueue_1.default("order", {
    redisUrl: `redis://redis:6379`,
    retryDelay: 0,
    nextJobProcessDelay: 0
});
orderQueue.on("ready", () => orderQueue === null || orderQueue === void 0 ? void 0 : orderQueue.slats());
orderQueue.on("redis-connected", () => {
    console.log("redis connected");
});
orderQueue.on("redis-connection-fail", (ex) => {
    console.log("redis connection fail ", ex);
});
orderQueue.on("fail", (jobId) => {
    console.log("task fail ", jobId);
});
orderQueue.on("done", (jobId, a, state) => {
    console.log("state:: ", Object.keys(state.jobs).length, state.queue.length);
    console.log("task done ", jobId);
});
orderQueue.on("finished", (state) => {
    console.log("finished:: ", Object.keys(state.jobs).length, state.queue.length);
});
orderQueue.on("ready", (state) => {
    console.log("ready:: ", Object.keys(state.jobs).length, state.queue.length);
});
orderQueue.on("processing", function (jobId, data, done) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Processing job:: ", jobId);
        try {
            const client = yield (0, db_1.dbClient)();
            const orderData = JSON.parse(data);
            // done(false)
            const { rowCount } = yield client.query({
                text: `insert into orders(customer_id, price, product_id, created_at)
                   values ($1, $2, $3, $4)`,
                values: [
                    orderData.customerId,
                    orderData.price,
                    orderData.productId,
                    orderData.createdAt,
                ]
            });
            if (!rowCount)
                throw Error("Order place fail:::");
            done(true);
        }
        catch (ex) {
            console.error(ex === null || ex === void 0 ? void 0 : ex.message);
            done(false);
        }
    });
});
app.get("/order", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { productId, price, customerId } = req.body;
    let newOrder;
    for (let i = 0; i < 100; i++) {
        const taskId = Date.now().toString() + "-" + i;
        newOrder = {
            productId,
            price: price,
            customerId,
            createdAt: new Date().toISOString()
        };
        yield orderQueue.createJob(taskId, newOrder);
    }
    orderQueue.slats();
    res.send({
        order: newOrder,
        message: "Order has been added on queue"
    });
}));
exports.default = app;
