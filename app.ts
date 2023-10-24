import express, {Response, Request, NextFunction} from "express"
import "reflect-metadata";
import RsQueue from "./lib/RSQueue";

const app = express()
app.use(express.json())


const queue = new RsQueue('twitter', {
    redisUrl: "redis://127.0.0.1:6379",
    retryDelay: 2000
})


queue.on("processing", executeTask.bind(this))
queue.on("ready", () => queue?.slats()) // initial log

function executeTask(){

}

app.get("/", (req: Request, res: Response) => {
    console.log("skdfj")
    res.send("hisdf")
})



app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    res.send(err.message)
})


app.listen(2200, () => console.log("server is running on port 2200"))

