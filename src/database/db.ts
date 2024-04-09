import {Pool} from "pg";

const pool = new Pool({
    user: "postgres",
    host: "postgres",
    database: "rs_queue",
    password: "123",
    port: 5432,
});


export function dbClient(){
    if(global._client) return global._client;
    global._client = pool.connect()
    return global._client
}


export default pool;