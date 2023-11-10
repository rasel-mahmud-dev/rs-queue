import express, {Response, Request, NextFunction} from "express"
import "reflect-metadata";
import RsQueue from "./lib/RSQueue";


import AppDataSource from "./database/db";
import {Tweet} from "./Models/Tweet";

const app = express()
app.use(express.json())


const tweetQueue = new RsQueue('tweet', {
    redisUrl: "redis://127.0.0.1:6379",
    retryDelay: 2000,
    nextJobProcessDelay: 100,
})


tweetQueue.on("processing", executeTask)
tweetQueue.on("ready", () => tweetQueue?.slats()) // initial log

async function executeTask(jobId: string, data: string, done: Function) {
    try {
        console.log("currently processing job : ", jobId)
        let tweet = JSON.parse(data)
        await AppDataSource.manager.save(Tweet, tweet)
        // data saved on the database 
        done(true) // tell rs-queue to success this job
    } catch (error) {
        done(false)
    } finally {
        tweetQueue?.slats()
    }

}

app.get("/", async (_req: Request, res: Response) => {
    try {
        let tweets = await AppDataSource.manager.find(Tweet, {})
        res.status(200).send(tweets)
    } catch (error) {
        res.status(500).json({message: "error"})
    }
})


app.post("/add-tweet", (req: Request, res: Response) => {
    // logged user id
    const userId = 1
    const tweet = {
        title: req.body.title,
        content: req.body.content,
        cover: req.body.cover,
        authorId: userId,
        createdAt: new Date()
    }

    const jobId = userId + Date.now().toString()
    // pass in background in queue
    tweetQueue.createJob(jobId, tweet)

    res.status(201).json(tweet)
})


app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    res.send(err.message)
})


app.listen(2200, () => console.log("server is running on port 2200"))

