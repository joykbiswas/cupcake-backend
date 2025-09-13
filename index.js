const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();  
const port = process.env.PORT || 5000;

//middleware
app.use(cors(
  {
    origin: ["https://cupcake-two.vercel.app", "http://localhost:5173"
    ],
    Credential: true,
    optionSuccessStatus: 200,
  }
));

app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cqpfzla.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const cakeCollection = client.db('cakeDB').collection('cake');
    const usersCollection = client.db('cakeDB').collection('users');
     const cartCollection = client.db('cakeDB').collection('carts');
     const paymentCollection = client.db('cakeDB').collection('payments');

    //jwt related api
    app.post('/jwt', async(req, res) =>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn:'1h'});
        console.log("token inside", token);
        res.send({token});
    })

    // middleware
    const verifyToken = (req, res, next) =>{
      // console.log('inside verifyToken',req.headers.authorization);
      if(!req.headers.authorization){
        return res.status(401).send({message: 'unauthorized access'});
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token,process.env.ACCESS_TOKEN_SECRET, (err, decoded) =>{
        if(err){
          return res.status(401).send({message: 'unauthorized access'})
        }
        req.decoded = decoded;
         next();
      })
    } 
    app.get('/users',verifyToken, async (req, res) =>{
      const result = await usersCollection.find().toArray()
      res.send(result);
    })
    
    app.get('/all-users', async(req, res) =>{
      const result = await usersCollection.find().toArray()
      res.send(result);
    })

    app.post('/users', async(req, res) =>{
      const user =req.body;
      const query = {email: user.email}
      const existingUser = await usersCollection.findOne(query)
      if(existingUser){
        return res.send({message: 'user already exists', insertedId: null})
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    })

    app.post('/cake', async (req, res) => {
      const newCake = req.body;
      console.log(newCake);
      const result = await cakeCollection.insertOne(newCake);
      res.send(result);
    });

    app.get('/cake', async (req, res) => {
      const cursor = cakeCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    
    app.get('/cake/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cakeCollection.findOne(query);
      res.send(result);
    });

    app.patch('/cake/:id', async (req, res) => {
      const id = req.params.id;
      const item = req.body; 
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: item.name,
          description: item.description,
          sizes: item.sizes,
          price: item.price,
          images: item.images,
          category: item.category,
          tags: item.tags,
          inStock: item.inStock
        }
      };
      const result = await cakeCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete('/cake/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cakeCollection.deleteOne(query);
      res.send(result);
    }); 

    // cart collection
   
    app.post('/cart', async (req, res) =>{ 
      const  cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.get('/cart', verifyToken, async (req, res) =>{
      const email = req.query.email; 
      const query = {email: email};
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.delete('/cart/:id', async (req, res) =>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      console.log(result);
      res.send(result);
    });

    // payment intent
    app.post('/create-payment-int', async(req, res) =>{
      const {price} = req.body;
      const amount = parseInt(price * 100)
      console.log('amount inside', amount);

      const paymentIntent = await stripe.paymentIntents.create({
        amount:amount,
        currency: "usd",
        payment_method_types: [
          "card"
        ],
      })
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.post('/payments', async (req, res) =>{
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      // delete each item from the cart
      console.log('payment info', payment);
      const query = {_id: {
        $in: payment.cartIds.map(id=>new ObjectId(id))
      }}

      const deleteResult = await cartCollection.deleteMany(query);
    res.send({paymentResult, deleteResult});
    })


     // using aggregate pipeline
    app.get('/order-stats', async(req, res) =>{
      const result = await paymentCollection.aggregate([
        {
          $unwind: '$menuItemIds'
        },
        {
          $lookup:{
            from: 'menu',
            localField:'menuItemIds',
            foreignField: '_id',
            as: 'menuItems'
           
          }
        },
        {
          $unwind: '$menuItems'
        },
        {
          $group: {
            _id: '$menuItems.category',
            quantity: {$sum: 1},
            revenue: {$sum: '$menuItems.price'}
          }
        },
        {
          $project: {
            _id: 0,
            category: '$_id',
            quantity: '$quantity',
            revenue: '$revenue'
          }
        }
      ]).toArray();
      res.send(result);
    })

    // starts or analytics
    app.get('/admin-stats',verifyToken,  async(req, res) =>{
      const users = await usersCollection.estimatedDocumentCount();
      const menuItem =await cakeCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // const payments = await paymentCollection.find().toArray();
      // const revenue = payments.reduce((total, payment) => total+ payment.price,0);

      const result = await paymentCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: '$price'
            }
          }
        }
      ]).toArray();
      const revenue = result.length > 0 ? result[0].totalRevenue : 0;
      res.send({
        users,
        menuItem,
        orders,
        revenue

      })
    })

    // payment history show valid user 
    app.get('/payments/:email',verifyToken, async(req, res) =>{
      const query = { email: req.params.email}
      if(req.params.email !== req.decoded.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const result = await paymentCollection.find(query).toArray()
      res.send(result);
    })

    // payment history show valid user 
    app.get('/all-payments', async(req, res) =>{
      const result = await paymentCollection.find().toArray()
      res.send(result);
    })




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send("Cake making management server is running");
})

// app.listen(port, () => {
//     console.log(`server is running on port: ${port}`);
// });
module.exports = app;