import express, {Application} from "express";
import dotenv from "dotenv";
import RsQueue from "../../lib";

import {dbClient} from "./db";

dotenv.config();

const app: Application = express();
app.use(express.json());

const orderQueue = new RsQueue("order", {
    redisUrl: `redis://redis:6379`,
    delayedDebounce: 1000,
})

orderQueue.on("ready", () => orderQueue?.slats())

orderQueue.on("redis-connected", () => {
    console.log("redis connected")
})
orderQueue.on("redis-connection-fail", (ex) => {
    console.log("redis connection fail ", ex)
})
orderQueue.on("fail", (jobId) => {
    console.log("task failed ", jobId)
})
orderQueue.on("retrying", (jobId) => {
    console.log("task fail retrying ", jobId)
})
orderQueue.on("done", (jobId, a, state) => {
    console.log("state:: ",
        Object.keys(state.jobs).length, state.queue.length
    )
    console.log("task done ", jobId)
})
orderQueue.on("finished", (state) => {
    console.log("finished:: ",
        Object.keys(state.jobs).length, state.queue.length
    )
})
orderQueue.on("ready", (state) => {
    console.log("ready:: ",
        Object.keys(state.jobs).length, state.queue.length
    )
})
orderQueue.on("reset", (state) => {
    console.log("reset:: trigger ",
        state.queue.length
    )
})


orderQueue.on("processing", async function (jobId, data, done) {
    console.log("Processing job:: ", jobId, data?.opt)
    try {
        const orderData = data?.data

        if(!orderData) throw Error("Job data not found")

        const client = await dbClient()
        const {rowCount} = await client.query({
            text: `insert into orders(customer_id, price, product_id, created_at)
                   values ($1, $2, $3, $4)`,
            values: [
                orderData.customerId,
                orderData.price,
                orderData.productId,
                orderData.createdAt,
            ]
        })

        if (!rowCount) throw Error("Order place fail:::");
        done(true)

    } catch (ex: any) {
        console.error(ex?.message)
        done(false)
    }
})

app.post("/order", async (req, res) => {
    const {productId, price, customerId} = req.body

    let newOrder;

    for (let i = 0; i < 20; i++) {
        const taskId = Date.now().toString() + "-" + i
        newOrder = {
            productId,
            price: price,
            customerId,
            createdAt: new Date().toISOString()
        }
        await orderQueue.createJob(taskId, newOrder)
            // .retries(10) // now it retry failed job infinity
            .delayUntil(200)
            .save()
    }

    orderQueue.slats();

    res.send({
        order: newOrder,
        message: "Order has been added on queue"
    })
})

app.get("/reset-task", async (req, res) => {
    await orderQueue.restoreJobs()
    res.send({
        message: "Job task has been reset"
    })
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
    console.info(
        `Application listening on localhost: ${PORT}`
    );
});