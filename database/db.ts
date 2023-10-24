import { DataSource } from "typeorm"
import {User} from "../Models/User";
import {Tweet} from "../Models/Tweet";
import {Like} from "../Models/Like";
import {Comment} from "../Models/Comment";
import {Role} from "../Models/Role";
import {UserRoleMapping} from "../Models/UserRoleMapping";
import {Product} from "../Models/Product";
import {Category} from "../Models/Category";

const AppDataSource = new DataSource({
    type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "rasel",
    database: "type_orm",
    entities: [User, Tweet, Like, Comment, Role, UserRoleMapping, Product, Category],
    synchronize: true,
    logging: false,
})

AppDataSource.initialize()
    .then(() => {
        console.log("Data Source has been initialized!")
    })
    .catch((err) => {
        console.error("Error during Data Source initialization", err)
    })


export default AppDataSource;