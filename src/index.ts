import app from "./app";

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {

    console.info(
        `Application listening on localhost: ${PORT}`
    );


});
