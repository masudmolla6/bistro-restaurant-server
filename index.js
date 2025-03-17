const express = require("express");
require("dotenv").config();
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;


// middlewares
app.use(express.json());
app.use(cors());


const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6ygkpv0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const menuCollections = client.db("bistroDb").collection("menu");
    const reviewsCollections = client.db("bistroDb").collection("reviews");
    const cartCollections = client.db("bistroDb").collection("carts");
    const userCollections = client.db("bistroDb").collection("users");
    const paymentCollections = client.db("bistroDb").collection("payments");

    // middlewares
    const verifyToken = async (req, res, next) => {
      // console.log("inside verify token",req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        // console.log("decodded email",decoded.email);
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      // console.log("line-56", email);
      const query = { email: email };
      const user = await userCollections.findOne(query);
      // console.log(user);
      const isAdmin = user?.role === "admin";
      // console.log("Is Admin", isAdmin);
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // jwt Related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      // console.log(req.headers.authorization);
      const result = await userCollections.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      // console.log(email);
      // console.log("line-83",req.decoded.email);
      if (email !== req.decoded?.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollections.findOne(query);
      // console.log(user);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollections.findOne(query);
      if (existingUser) {
        return res.send({
          message: "User already Exist in the database",
          insertedId: null,
        });
      }
      const result = await userCollections.insertOne(user);
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const makeAdmin = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollections.updateOne(query, makeAdmin);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollections.deleteOne(query);
      res.send(result);
    });

    // menu collections
    app.get("/menu", async (req, res) => {
      const result = await menuCollections.find().toArray();
      res.send(result);
    });

    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollections.insertOne(item);
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollections.findOne(query);
      res.send(result);
    });

    app.patch("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const query = { _id: id };
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuCollections.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollections.deleteOne(query);
      res.send(result);
    });

    // Payment Related api.
    app.get("/payment/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollections.find(query).toArray();
      res.send(result);
    })


    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      console.log(price);
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollections.insertOne(payment);
      console.log("Payment Info", payment);

      // Carefully:Delete Each Item in the Database.
      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id))
        }
      }
      const deleteCartResult = await cartCollections.deleteMany(query);

      res.send({paymentResult,deleteCartResult});
    })

    // cart collections

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollections.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollections.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollections.deleteOne(query);
      res.send(result);
    });

    // reviews collections
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollections.find().toArray();
      res.send(result);
    });


    // Stats Or Analytics
    app.get("/admin-stats",verifyToken,verifyAdmin, async (req, res) => {
      const users = await userCollections.estimatedDocumentCount();
      const menuItems = await menuCollections.estimatedDocumentCount();
      const orders = await paymentCollections.estimatedDocumentCount();

      // this is not the best way
      // const payments = await paymentCollections.find().toArray();

      // const revenue = payments.reduce((total, payment) => total + payment.price, 0);

      const result = await paymentCollections.aggregate([
        {
          $group: {
            _id: null,
            totallRevenue: {
              $sum: "$price",
            },
          },
        },
      ]).toArray();

      const revenue = result.length > 0 ? result[0] : 0;

      res.send({
        users,
        menuItems,
        orders,
        revenue
      })
    })

    app.get("/order-stats",verifyToken,verifyAdmin, async (req, res) => {
      const result = await paymentCollections
        .aggregate([
          {
            $unwind: "$menuItemIds",
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuItemIds",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: { $sum: 1 },
              revenue: { $sum: "$menuItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue:"$revenue",
            }
          }
        ])
        .toArray();

      res.send(result);
    })

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("Bistro boss is running.")
})

app.listen(port, () => {
    console.log("Server is Running from port", port);
})

