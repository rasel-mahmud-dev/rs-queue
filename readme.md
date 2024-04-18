# **rs-queue**

**`rs-queue`** is a lightweight Redis-based queue management library for Node.js applications. It provides a simple yet powerful interface for handling asynchronous tasks and job processing.

## **Installation**

```bash
npm install rs-queue
```

## **Features**

- Asynchronous job processing
- Job retries and delay handling
- Event-driven architecture using Node.js **`EventEmitter`**
- Simple and intuitive API

## **Usage**

[![NPM](https://nodei.co/npm/rs-queue.png?downloads=true)](https://nodei.co/npm/rs-queue/)

### **Initialization**

```tsx
import RsQueue from "rs-queue";

const orderQueue = new RsQueue("order", {
    redisUrl: `redis://localhost:6379`,
    delayedDebounce: 1000 // default
});

```

### **Create a Job**

```tsx

const jobId = "unique-job-id";
const jobData = {
    productId: "12345",
    price: 100.0,
    customerId: "67890",
    createdAt: new Date().toISOString(),
};

const job = orderQueue.createJob(jobId, jobData)
    .delayUntil(200) // Delay job processing by 200 milliseconds
    .save(); // Save the job to the queue

```

### **Event Handling**

```tsx

orderQueue.on("processing", (jobId, jobDetail, done) => {
    // Process the job
    // ...

    // Call done() to indicate job completion
    done(true);
});

orderQueue.on("fail", (jobId, jobDetail) => {
    // Handle failed jobs
});

orderQueue.on("finished", (state) => {
    // All jobs in the queue have been processed
});

```

### **Additional Methods**

- **`retries(n: number)`**: Set the number of retries for a job.
- **`delayUntil(millisecond: number)`**: Delay job processing by a specified time.
- `restoreJobs` : Reset all job queue task

## **Events**

- **`ready`**: Emitted when the queue is ready.
- **`redis-connected`**: Emitted when connected to Redis.
- **`redis-connection-fail`**: Emitted when failed to connect to Redis.
- **`fail`**: Emitted when a job fails.
- **`done`**: Emitted when a job is successfully processed.
- **`finished`**: Emitted when all jobs in the queue have been processed.
- **`processing`**: Emitted when a job starts processing.
- **`new`**: Emitted when a new job is added to the queue.

# **Integrating With Real world Project with Express.js for Order Processing**

In this tutorial, we'll explore how to integrate Redis Queue with an Express.js application to manage and process orders asynchronously.

## **Prerequisites**

Make sure you have the following installed:

- Node.js and npm
- Redis server

## **Setting Up the Project**

Start by initializing a new Node.js project:

```bash

mkdir express-redis-queue

cd express-redis-queue
npm init -y

```

Install the required dependencies:

```bash
bashCopy code
npm install express dotenv rs-queue

```

## **Project Structure**

Here's a basic project structure:

```
plaintextCopy code
express-redis-queue/
|-- node_modules/
|-- src/
|   |-- db.ts
|   |-- index.ts
|-- package.json
|-- tsconfig.json

```

## 

## **Code Overview**

### **`db.ts`**

This file initializes a database connection:

```tsx
typescriptCopy code
import { Client } from 'pg';

export const dbClient = async () => {
    const client = new Client({
        // database configuration
    });

    await client.connect();
    return client;
};

```

### **`index.ts`**

This is the main application file:

```tsx
import express, {Application} from "express";
import dotenv from "dotenv";
import RsQueue from "rs-queue";

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
    console.log("task fail ", jobId)
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

// orderQueue.restoreJobs()

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

app.get("/order", async (req, res) => {
    const {productId, price, customerId} = req.body

    let newOrder;

    for (let i = 0; i < 200; i++) {
        const taskId = Date.now().toString() + "-" + i
        newOrder = {
            productId,
            price: price,
            customerId,
            createdAt: new Date().toISOString()
        }
        await orderQueue.createJob(taskId, newOrder)
            .delayUntil(200)
            .save()
    }

    orderQueue.slats();

    res.send({
        order: newOrder,
        message: "Order has been added on queue"
    })
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
    console.info(
        `Application listening on localhost: ${PORT}`
    );
});

```

## **Conclusion**

In this tutorial, we've set up an Express.js application integrated with Redis Queue to manage and process orders asynchronously. This approach allows us to offload heavy processing tasks to background jobs, ensuring better scalability and responsiveness for our application.

Feel free to customize this code to fit your specific requirements and enhance the functionality as needed.