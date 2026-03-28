-- CreateTable
CREATE TABLE "smart" (
    "id" SERIAL NOT NULL,
    "node_id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smart_pkey" PRIMARY KEY ("id")
);
